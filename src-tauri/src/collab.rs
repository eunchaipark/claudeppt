// 팀 협업 서버 — 「설정 › 협업」을 켜면 이 앱(호스트) 안에서 HTTP + WebSocket 을 연다. 끄면 닫는다. 기본은 꺼짐.
//
//   화면       같은 React 화면을 브라우저에 내준다 (설치 판: 앱에 담긴 화면 · 개발 실행: Vite 로 넘긴다)
//   슬라이드    /_/deck/<id>[@커밋]/<경로> — deck:// 와 같은 serve() 를 쓴다 (경로 검사 · 런타임 끼우기 그대로)
//   상태       호스트 화면이 덱 · 대화 · 세션 · 판을 collab_publish 로 올리면 접속한 모든 브라우저에 /_/ws 로 보낸다.
//              새로 붙거나(다시 붙기 포함) 따라가지 못한 브라우저에는 지금 것을 통째로 다시 보낸다
//   의도       브라우저가 하려는 일(요청 보내기 · 직접 편집 · 의견)은 호스트 화면에 「collab-intent」 사건으로 넘기고 답을 기다린다.
//              쓰기는 호스트 한 곳에서만 — 두 화면이 같은 파일 · 대화 기록을 따로 쓰면 하나가 다른 것을 덮는다
//   접속       누가 붙었고 어느 쪽을 보는지(members). 모든 브라우저와 호스트 화면에 알린다
//   열쇠       켤 때 만드는 토큰. 링크(?k=)로 한 번 들어오면 쿠키로 바꾸고 주소에서 뗀다. 모든 요청에 쿠키나 토큰이 있어야 한다.
//              IP 로 믿지 않는다 — 바깥 길(터널)로 온 요청은 127.0.0.1 로 보인다
//   읽기       /_/rpc 는 허용 목록뿐 — 열려 있는 덱 안 파일 읽기 · 판 목록. 쓰기 · 절대 경로 · 설정 · claude 실행은 없다

use crate::{AppState, Res, err};
use axum::Router;
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Request, State as Ax};
use axum::http::{HeaderMap, HeaderValue, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{broadcast, mpsc, oneshot};

const COOKIE: &str = "cppt_k";
/// 처음 해 보는 포트 — 쓰이고 있으면 아무 빈 포트
const DEFAULT_PORT: u16 = 47815;
/// 의도 하나를 기다리는 가장 긴 시간 — Claude 턴이 오래 돈다
const INTENT_WAIT: Duration = Duration::from_secs(3 * 60 * 60);
/// 브라우저가 부를 수 있는 의도. 호스트 화면(collab.ts)도 같은 목록만 받는다 — 둘 다 지켜야 넘어간다
const INTENTS: &[&str] = &["send", "stop", "newTalk", "direct", "undo", "redo", "pinAdd", "pinUpdate", "pinRemove", "pinResolve", "pinSend", "upload"];

#[derive(Default)]
pub struct Collab {
	hub: Mutex<Option<Arc<Hub>>>,
	stop: Mutex<Option<oneshot::Sender<()>>>,
}

pub struct Hub {
	app: AppHandle,
	token: String,
	port: u16,
	tx: broadcast::Sender<Arc<str>>,
	shared: Mutex<Shared>,
	members: Mutex<BTreeMap<u64, Member>>,
	pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
	next: AtomicU64,
}

/// 호스트가 올린 상태. turns 는 따로 — 글자가 흐르는 동안 바뀐 턴만 오간다
#[derive(Default)]
struct Shared {
	seq: u64,
	set: Map<String, Value>,
	order: Vec<String>,
	turns: HashMap<String, Value>,
}

#[derive(Clone, Serialize)]
pub struct Member {
	conn: u64,
	name: String,
	slide: Option<String>,
	host: bool,
	since: i64,
}

#[derive(Serialize)]
pub struct Info {
	port: u16,
	token: String,
	urls: Vec<String>,
	members: Vec<Member>,
}

fn now() -> i64 {
	chrono::Utc::now().timestamp_millis()
}

/// 같은 길이 · 같은 글자인지 — 글자마다 비교 시간을 같게 (열쇠를 한 글자씩 알아내지 못하게)
fn same(a: &str, b: &str) -> bool {
	a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// 이 PC 의 사무실 망 주소 — 밖으로 나가는 기본 길의 주소. UDP 는 connect 만으로는 아무것도 보내지 않는다
fn lan_ip() -> Option<String> {
	let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
	s.connect("8.8.8.8:80").ok()?;
	let ip = s.local_addr().ok()?.ip();
	(!ip.is_loopback() && !ip.is_unspecified()).then(|| ip.to_string())
}

impl Hub {
	fn info(&self) -> Info {
		let mut urls = vec![];
		if let Some(ip) = lan_ip() {
			urls.push(format!("http://{ip}:{}/?k={}", self.port, self.token));
		}
		urls.push(format!("http://localhost:{}/?k={}", self.port, self.token));
		Info { port: self.port, token: self.token.clone(), urls, members: self.members.lock().unwrap().values().cloned().collect() }
	}

	/// 새로 붙은 브라우저에 줄 지금 상태 통째
	fn snapshot(&self) -> String {
		let s = self.shared.lock().unwrap();
		let put: Vec<&Value> = s.order.iter().filter_map(|id| s.turns.get(id)).collect();
		json!({ "t": "state", "seq": s.seq, "full": true, "patch": { "set": s.set, "turns": { "order": s.order, "put": put } } }).to_string()
	}

	/// 호스트가 올린 바뀐 것을 쌓고 모두에게 보낸다
	fn publish(&self, patch: Value) {
		let msg = {
			let mut s = self.shared.lock().unwrap();
			if patch.get("reset").and_then(Value::as_bool) == Some(true) {
				*s = Shared { seq: s.seq, ..Default::default() };
			}
			if let Some(set) = patch.get("set").and_then(Value::as_object) {
				for (k, v) in set {
					s.set.insert(k.clone(), v.clone());
				}
			}
			if let Some(t) = patch.get("turns") {
				if let Some(order) = t.get("order").and_then(Value::as_array) {
					s.order = order.iter().filter_map(|x| x.as_str().map(String::from)).collect();
					let keep: std::collections::HashSet<String> = s.order.iter().cloned().collect();
					s.turns.retain(|k, _| keep.contains(k));
				}
				for turn in t.get("put").and_then(Value::as_array).into_iter().flatten() {
					if let Some(id) = turn.get("id").and_then(Value::as_str) {
						s.turns.insert(id.to_string(), turn.clone());
					}
				}
			}
			s.seq += 1;
			json!({ "t": "state", "seq": s.seq, "patch": patch }).to_string()
		};
		let _ = self.tx.send(msg.into());
	}

	fn members_changed(&self) {
		let list: Vec<Member> = self.members.lock().unwrap().values().cloned().collect();
		let _ = self.tx.send(json!({ "t": "members", "list": list }).to_string().into());
		let _ = self.app.emit("collab-members", &list);
	}
}

fn hub(app: &AppHandle) -> Option<Arc<Hub>> {
	app.state::<Collab>().hub.lock().unwrap().clone()
}

// ── 명령 (호스트 화면) ──

/// 켠다. 이미 켜져 있으면 지금 것을 돌려준다
#[tauri::command]
pub async fn collab_start(app: AppHandle) -> Res<Info> {
	if let Some(h) = hub(&app) {
		return Ok(h.info());
	}
	let listener = match tokio::net::TcpListener::bind(("0.0.0.0", DEFAULT_PORT)).await {
		Ok(l) => l,
		Err(_) => tokio::net::TcpListener::bind(("0.0.0.0", 0)).await.map_err(err)?,
	};
	let port = listener.local_addr().map_err(err)?.port();
	let (tx, _) = broadcast::channel(512);
	let h = Arc::new(Hub {
		app: app.clone(),
		token: uuid::Uuid::new_v4().simple().to_string(),
		port,
		tx,
		shared: Mutex::new(Shared::default()),
		members: Mutex::new(BTreeMap::new()),
		pending: Mutex::new(HashMap::new()),
		next: AtomicU64::new(1),
	});
	let (stop_tx, stop_rx) = oneshot::channel::<()>();
	let router = routes(h.clone());
	tauri::async_runtime::spawn(async move {
		let _ = axum::serve(listener, router).with_graceful_shutdown(async { let _ = stop_rx.await; }).await;
	});
	let c = app.state::<Collab>();
	*c.hub.lock().unwrap() = Some(h.clone());
	*c.stop.lock().unwrap() = Some(stop_tx);
	Ok(h.info())
}

/// 끈다 — 붙어 있던 브라우저는 모두 끊긴다
#[tauri::command]
pub fn collab_stop(state: State<Collab>) {
	if let Some(tx) = state.stop.lock().unwrap().take() {
		let _ = tx.send(());
	}
	if let Some(h) = state.hub.lock().unwrap().take() {
		let _ = h.tx.send(json!({ "t": "bye" }).to_string().into());
		for (_, tx) in h.pending.lock().unwrap().drain() {
			let _ = tx.send(json!({ "ok": false, "error": "stopped" }));
		}
	}
}

#[tauri::command]
pub fn collab_info(app: AppHandle) -> Option<Info> {
	hub(&app).map(|h| h.info())
}

/// 호스트 화면이 바뀐 상태를 올린다 — { set?: {키: 값}, turns?: { order?, put? }, reset? }
#[tauri::command]
pub fn collab_publish(app: AppHandle, patch: Value) {
	if let Some(h) = hub(&app) {
		h.publish(patch);
	}
}

/// 호스트 화면이 의도에 답한다 — { ok, value? , error? }
#[tauri::command]
pub fn collab_reply(app: AppHandle, id: String, reply: Value) {
	if let Some(h) = hub(&app) {
		if let Some(tx) = h.pending.lock().unwrap().remove(&id) {
			let _ = tx.send(reply);
		}
	}
}

/// 호스트도 한 사람으로 — 이름 · 보는 쪽
#[tauri::command]
pub fn collab_view(app: AppHandle, name: String, slide: Option<String>) {
	if let Some(h) = hub(&app) {
		h.members.lock().unwrap().insert(0, Member { conn: 0, name, slide, host: true, since: now() });
		h.members_changed();
	}
}

// ── HTTP ──

fn routes(h: Arc<Hub>) -> Router {
	Router::new()
		.route("/_/ws", get(ws))
		.route("/_/rpc", post(rpc))
		.route("/_/deck/{*rest}", get(deck))
		.route("/__rt.js", get(deck_rt))
		.fallback(get(front))
		.layer(middleware::from_fn_with_state(h.clone(), auth))
		.with_state(h)
}

fn cookie_of(headers: &HeaderMap) -> Option<String> {
	let raw = headers.get(header::COOKIE)?.to_str().ok()?;
	raw.split(';').map(str::trim).find_map(|c| c.strip_prefix(&format!("{COOKIE}=")).map(String::from))
}

fn query_of(uri: &Uri, key: &str) -> Option<String> {
	uri.query()?.split('&').find_map(|kv| kv.strip_prefix(&format!("{key}=")).map(String::from))
}

/// 열쇠 검사 — 쿠키 또는 ?k=. 링크로 처음 들어온 화면 요청은 쿠키를 심고 주소에서 열쇠를 뗀다
async fn auth(Ax(h): Ax<Arc<Hub>>, req: Request, next: Next) -> Response {
	if cookie_of(req.headers()).is_some_and(|c| same(&c, &h.token)) {
		return next.run(req).await;
	}
	let Some(k) = query_of(req.uri(), "k").filter(|k| same(k, &h.token)) else {
		return (StatusCode::UNAUTHORIZED, [(header::CONTENT_TYPE, "text/html; charset=utf-8")], DENIED).into_response();
	};
	let _ = k;
	let path = req.uri().path().to_string();
	if path.starts_with("/_/") {
		return next.run(req).await;
	}
	// 주소창 · 방문 기록에 열쇠가 남지 않게 뗀 주소로 다시 보낸다. SameSite=Lax — 채팅 앱에서 링크를 눌러 들어온 첫 이동에도 쿠키가 붙어야 한다
	let rest: Vec<&str> = req.uri().query().unwrap_or("").split('&').filter(|kv| !kv.starts_with("k=") && !kv.is_empty()).collect();
	let to = if rest.is_empty() { path } else { format!("{path}?{}", rest.join("&")) };
	let mut r = Response::new(Body::empty());
	*r.status_mut() = StatusCode::SEE_OTHER;
	r.headers_mut().insert(header::LOCATION, HeaderValue::from_str(&to).unwrap_or(HeaderValue::from_static("/")));
	r.headers_mut().insert(header::SET_COOKIE, HeaderValue::from_str(&format!("{COOKIE}={}; HttpOnly; SameSite=Lax; Path=/", h.token)).unwrap());
	r
}

const DENIED: &str = "<!doctype html><meta charset=utf-8><title>ClaudePPT</title><body style=\"font:15px system-ui;padding:40px\"><p>초대 링크로 들어와 주세요. 호스트에게 링크를 다시 받아 주세요.</p><p>Please open the invite link again. Ask the host for a new one.</p>";

fn from_tauri(r: tauri::http::Response<Vec<u8>>) -> Response {
	r.map(Body::from)
}

async fn deck(Ax(h): Ax<Arc<Hub>>, uri: Uri) -> Response {
	let rest = uri.path().trim_start_matches("/_/deck");
	from_tauri(crate::serve(&h.app, rest))
}

async fn deck_rt(Ax(h): Ax<Arc<Hub>>) -> Response {
	from_tauri(crate::serve(&h.app, "/__rt.js"))
}

/// 화면 파일. 설치 판은 앱에 담긴 것, 개발 실행은 Vite(devUrl)로 넘긴다 — 개발 중 고친 화면이 바로 보이게
async fn front(Ax(h): Ax<Arc<Hub>>, uri: Uri) -> Response {
	if tauri::is_dev() {
		let Some(base) = h.app.config().build.dev_url.clone() else { return StatusCode::NOT_FOUND.into_response() };
		let url = format!("{}{}", base.as_str().trim_end_matches('/'), uri.path_and_query().map(|p| p.as_str()).unwrap_or("/"));
		return match reqwest::get(&url).await {
			Ok(r) => {
				let status = StatusCode::from_u16(r.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
				let ct = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("application/octet-stream").to_string();
				let body = r.bytes().await.unwrap_or_default();
				(status, [(header::CONTENT_TYPE, ct)], body).into_response()
			}
			Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
		};
	}
	let path = uri.path();
	let asset = h.app.asset_resolver().get(path.to_string()).or_else(|| h.app.asset_resolver().get("/index.html".into()));
	match asset {
		Some(a) => (StatusCode::OK, [(header::CONTENT_TYPE, a.mime_type)], a.bytes).into_response(),
		None => StatusCode::NOT_FOUND.into_response(),
	}
}

/// 읽기만 — 열려 있는 덱(id) 안
async fn rpc(Ax(h): Ax<Arc<Hub>>, axum::Json(q): axum::Json<Value>) -> Response {
	let cmd = q["cmd"].as_str().unwrap_or("");
	let a = &q["args"];
	let dir = a["id"].as_str().and_then(|id| h.app.state::<AppState>().projects.lock().unwrap().get(id).cloned());
	let Some(dir) = dir else { return (StatusCode::NOT_FOUND, "덱이 열려 있지 않다").into_response() };
	let rel = a["rel"].as_str().unwrap_or("");
	let r: Res<Value> = match cmd {
		"read" => crate::fsx::inside(&dir.to_string_lossy(), rel).and_then(|p| std::fs::read_to_string(p).map_err(err)).map(Value::from),
		"exists" => crate::fsx::inside(&dir.to_string_lossy(), rel).map(|p| Value::from(p.exists())),
		"log" => {
			let limit = a["limit"].as_u64().map(|n| n as u32);
			let d = dir.to_string_lossy().to_string();
			tokio::task::spawn_blocking(move || crate::vcs::vcs_log(d, limit)).await.map_err(err).and_then(|r| r).map(|v| json!(v))
		}
		_ => Err(format!("원격에서는 쓸 수 없다: {cmd}")),
	};
	match r {
		Ok(v) => axum::Json(v).into_response(),
		Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
	}
}

// ── WebSocket ──

async fn ws(Ax(h): Ax<Arc<Hub>>, up: WebSocketUpgrade) -> Response {
	up.on_upgrade(move |s| conn(h, s))
}

async fn conn(h: Arc<Hub>, mut socket: WebSocket) {
	let id = h.next.fetch_add(1, Ordering::SeqCst);
	let (direct, mut inbox) = mpsc::unbounded_channel::<String>();
	let mut rx = h.tx.subscribe();
	let hello = json!({ "t": "hello", "conn": id }).to_string();
	if socket.send(Message::Text(hello.into())).await.is_err() || socket.send(Message::Text(h.snapshot().into())).await.is_err() {
		return;
	}
	let list: Vec<Member> = h.members.lock().unwrap().values().cloned().collect();
	let _ = socket.send(Message::Text(json!({ "t": "members", "list": list }).to_string().into())).await;
	loop {
		tokio::select! {
			m = socket.recv() => match m {
				Some(Ok(Message::Text(t))) => on_message(&h, id, &direct, t.as_str()),
				Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
				_ => {}
			},
			b = rx.recv() => match b {
				Ok(s) => { if socket.send(Message::Text(s.to_string().into())).await.is_err() { break; } }
				// 따라가지 못했다 — 지금 상태를 통째로 다시 준다
				Err(broadcast::error::RecvError::Lagged(_)) => { if socket.send(Message::Text(h.snapshot().into())).await.is_err() { break; } }
				Err(broadcast::error::RecvError::Closed) => break,
			},
			d = inbox.recv() => if let Some(s) = d { if socket.send(Message::Text(s.into())).await.is_err() { break; } },
		}
	}
	if h.members.lock().unwrap().remove(&id).is_some() {
		h.members_changed();
	}
}

fn on_message(h: &Arc<Hub>, conn: u64, direct: &mpsc::UnboundedSender<String>, text: &str) {
	let Ok(m) = serde_json::from_str::<Value>(text) else { return };
	match m["t"].as_str().unwrap_or("") {
		// 이름 · 보는 쪽 — 들어올 때와 쪽을 옮길 때
		"hello" | "view" => {
			let name = m["name"].as_str().map(|s| s.trim().chars().take(40).collect::<String>());
			let slide = m["slide"].as_str().map(String::from);
			{
				let mut ms = h.members.lock().unwrap();
				let e = ms.entry(conn).or_insert(Member { conn, name: String::new(), slide: None, host: false, since: now() });
				if let Some(n) = name.filter(|n| !n.is_empty()) {
					e.name = n;
				}
				e.slide = slide;
			}
			h.members_changed();
		}
		"intent" => {
			let cid = m["id"].clone();
			let name = m["name"].as_str().unwrap_or("").to_string();
			if !INTENTS.contains(&name.as_str()) {
				let _ = direct.send(json!({ "t": "reply", "id": cid, "ok": false, "error": format!("원격에서는 할 수 없다: {name}") }).to_string());
				return;
			}
			let who = h.members.lock().unwrap().get(&conn).map(|x| x.name.clone()).unwrap_or_default();
			let key = uuid::Uuid::new_v4().simple().to_string();
			let (tx, rx) = oneshot::channel();
			h.pending.lock().unwrap().insert(key.clone(), tx);
			let sent = h.app.emit("collab-intent", json!({ "id": key, "from": { "conn": conn, "name": who }, "name": name, "args": m["args"] }));
			let (h2, direct) = (h.clone(), direct.clone());
			tauri::async_runtime::spawn(async move {
				let reply = if sent.is_err() { json!({ "ok": false, "error": "host" }) } else {
					match tokio::time::timeout(INTENT_WAIT, rx).await {
						Ok(Ok(v)) => v,
						_ => json!({ "ok": false, "error": "timeout" }),
					}
				};
				h2.pending.lock().unwrap().remove(&key);
				let mut r = json!({ "t": "reply", "id": cid });
				if let (Some(o), Some(src)) = (r.as_object_mut(), reply.as_object()) {
					for (k, v) in src {
						o.insert(k.clone(), v.clone());
					}
				}
				let _ = direct.send(r.to_string());
			});
		}
		_ => {}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn token_compare_is_exact() {
		assert!(same("abc", "abc"));
		assert!(!same("abc", "abd"));
		assert!(!same("abc", "ab"));
		assert!(!same("", "a"));
	}

	#[test]
	fn reads_cookie_and_query() {
		let mut h = HeaderMap::new();
		h.insert(header::COOKIE, HeaderValue::from_static("a=1; cppt_k=tok; b=2"));
		assert_eq!(cookie_of(&h).as_deref(), Some("tok"));
		let u: Uri = "/x?y=1&k=abc&z=2".parse().unwrap();
		assert_eq!(query_of(&u, "k").as_deref(), Some("abc"));
		assert_eq!(query_of(&"/x".parse().unwrap(), "k"), None);
	}

	#[test]
	fn only_listed_intents_pass() {
		for ok in ["send", "direct", "pinAdd"] {
			assert!(INTENTS.contains(&ok));
		}
		for bad in ["exportTo", "release", "openProject", "settingsSave", "restore", "claudeRun"] {
			assert!(!INTENTS.contains(&bad));
		}
	}
}
