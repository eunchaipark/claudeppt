// 팀 협업 서버 — 「설정 › 협업」을 켜면 이 앱(호스트) 안에서 HTTP + WebSocket 을 연다. 끄면 닫는다. 기본은 꺼짐.
//
//   화면       같은 React 화면을 브라우저에 내준다 (설치 판: 앱에 담긴 화면 · 개발 실행: Vite 로 넘긴다)
//   슬라이드    /_/d/<덱 열쇠>/<id>[@커밋]/<경로> — deck:// 와 같은 serve() 를 쓴다 (경로 검사 · 런타임 끼우기 그대로).
//              브라우저는 슬라이드를 sandbox iframe(다른 출처)으로 연다 — 슬라이드 안 스크립트가 앱 화면에 손대거나 팀원 이름으로
//              의도를 보내지 못하게. 그래서 슬라이드는 쿠키가 아니라 주소 안 덱 열쇠로 연다(읽기 전용, 화면 열쇠와 다르다).
//              슬라이드 HTML 에는 CSP connect-src 'none' — 슬라이드 스크립트는 서버에 아무 요청도 못 한다
//   캐시 · 압축  지금 파일은 ETag + no-cache(바뀌지 않았으면 304), 판 고정 주소(@커밋)와 해시 붙은 화면 파일은 immutable. gzip
//   상태       호스트 화면이 덱 · 대화 · 세션 · 판을 collab_publish 로 올리면 접속한 모든 브라우저에 /_/ws 로 보낸다.
//              새로 붙거나(다시 붙기 포함) 따라가지 못한 브라우저에는 지금 것을 통째로 다시 보낸다
//   의도       브라우저가 하려는 일(요청 보내기 · 직접 편집 · 의견)은 호스트 화면에 「collab-intent」 사건으로 넘기고 답을 기다린다.
//              쓰기는 호스트 한 곳에서만 — 두 화면이 같은 파일 · 대화 기록을 따로 쓰면 하나가 다른 것을 덮는다
//   접속       누가 붙었고 어느 쪽을 보는지(members). 모든 브라우저와 호스트 화면에 알린다
//   초대       /j/<링크 열쇠> — 공용 링크는 이름을 한 번 적고, 개인 링크는 정한 이름으로 바로 들어온다. 들어오면 기기 쿠키(HttpOnly)를 받고
//              그 뒤로는 쿠키로 들어온다. 링크 · 기기 · 잠금은 invite.rs (앱 데이터 collab.json). 내보낸 기기는 그 자리에서 끊긴다.
//              그 밖의 모든 요청에 기기 쿠키가 있어야 한다. IP 로 믿지 않는다 — 바깥 길(터널)로 온 요청은 127.0.0.1 로 보인다.
//              팀원의 이름은 서버가 정한다(기기 이름) — 요청 · 편집 · 판의 보낸 사람이 브라우저가 적어 보낸 이름이 아니다.
//              /_/ws · /_/rpc 는 같은 출처(Origin)에서 온 것만 — 다른 출처 페이지가 팀원 브라우저의 쿠키로 붙지 못하게
//   읽기       /_/rpc 는 허용 목록뿐 — 열려 있는 덱 안 파일 읽기 · 판 목록. 쓰기 · 절대 경로 · 설정 · claude 실행은 없다

use crate::invite::{self, Book, Why};
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
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{broadcast, mpsc, oneshot};

const COOKIE: &str = "cppt_d";
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
	book: Mutex<Book>,
	book_path: PathBuf,
	/// 바깥 길(터널) — 열려 있으면 그 주소가 링크의 첫 주소가 된다
	tunnel: tokio::sync::Mutex<Option<crate::tunnel::Tunnel>>,
	public: Mutex<Option<(String, &'static str)>>,
	/// 연결 → (기기 id, 그 연결에 보내는 길) — 내보낼 때 끊는다
	conns: Mutex<HashMap<u64, (String, mpsc::UnboundedSender<String>)>>,
	/// 슬라이드 주소 안의 열쇠 — 열린 덱 파일 읽기만 된다
	deck_key: String,
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
	/// 기기 id (호스트는 "")
	device: String,
	name: String,
	slide: Option<String>,
	host: bool,
	since: i64,
}

#[derive(Serialize, Clone)]
pub struct Info {
	port: u16,
	/// 이 서버에 닿는 주소들 — 바깥 길(있으면 맨 앞) · 사무실 망 · 이 PC
	bases: Vec<String>,
	/// 바깥 길 — { url, kind: "tailscale" | "cloudflare" }
	tunnel: Option<TunnelView>,
	links: Vec<LinkView>,
	devices: Vec<DeviceView>,
	locked: bool,
	members: Vec<Member>,
}

#[derive(Serialize, Clone)]
struct TunnelView {
	url: String,
	kind: &'static str,
}

#[derive(Serialize, Clone)]
struct LinkView {
	id: String,
	url: String,
	name: Option<String>,
	expires: Option<i64>,
	expired: bool,
}

#[derive(Serialize, Clone)]
struct DeviceView {
	id: String,
	name: String,
	seen: i64,
	online: bool,
}

/// 요청을 보낸 기기 — auth 가 쿠키로 찾아 요청에 붙인다
#[derive(Clone)]
struct Who {
	device: String,
	name: String,
}

fn now() -> i64 {
	chrono::Utc::now().timestamp_millis()
}

use invite::same;

fn book_file() -> PathBuf {
	crate::control::data_dir().join("collab.json")
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
		let mut bases = vec![];
		let public = self.public.lock().unwrap().clone();
		if let Some((u, _)) = &public {
			bases.push(u.clone());
		}
		if let Some(ip) = lan_ip() {
			bases.push(format!("http://{ip}:{}", self.port));
		}
		bases.push(format!("http://localhost:{}", self.port));
		let members: Vec<Member> = self.members.lock().unwrap().values().cloned().collect();
		let b = self.book.lock().unwrap();
		let t = now();
		Info {
			port: self.port,
			links: b.links.iter().map(|l| LinkView { id: l.id.clone(), url: format!("{}/j/{}", bases[0], l.token), name: l.name.clone(), expires: l.expires, expired: l.expires.is_some_and(|e| e <= t) }).collect(),
			devices: b.devices.iter().rev().map(|d| DeviceView { id: d.id.clone(), name: d.name.clone(), seen: d.seen, online: members.iter().any(|m| m.device == d.id) }).collect(),
			locked: b.locked,
			tunnel: public.map(|(url, kind)| TunnelView { url, kind }),
			bases,
			members,
		}
	}

	fn save(&self) {
		self.book.lock().unwrap().save(&self.book_path);
	}

	/// 장부가 바뀌었다 — 파일에 남기고 호스트 화면에 알린다
	fn book_changed(&self) {
		self.save();
		let _ = self.app.emit("collab-info", self.info());
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
		book: Mutex::new({
			let mut b = Book::load(&book_file());
			b.ensure_public(now());
			b
		}),
		book_path: book_file(),
		tunnel: tokio::sync::Mutex::new(None),
		public: Mutex::new(None),
		conns: Mutex::new(HashMap::new()),
		deck_key: uuid::Uuid::new_v4().simple().to_string(),
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
	h.save();
	Ok(h.info())
}

fn with_hub(app: &AppHandle, f: impl FnOnce(&Hub)) -> Res<Info> {
	let h = hub(app).ok_or("협업이 꺼져 있다")?;
	f(&h);
	h.book_changed();
	Ok(h.info())
}

/// 링크를 만든다 — name 이 있으면 개인 링크, hours 가 있으면 그 시간 뒤 만료
#[tauri::command]
pub fn collab_link_new(app: AppHandle, name: Option<String>, hours: Option<u32>) -> Res<Info> {
	with_hub(&app, |h| {
		h.book.lock().unwrap().new_link(name, hours, now());
	})
}

/// 링크를 지운다 — 그 링크로 이미 들어온 기기는 그대로 (내보내려면 기기를 내보낸다)
#[tauri::command]
pub fn collab_link_remove(app: AppHandle, id: String) -> Res<Info> {
	with_hub(&app, |h| {
		let mut b = h.book.lock().unwrap();
		b.remove_link(&id);
		b.ensure_public(now());
	})
}

/// 기기를 내보낸다 — 붙어 있으면 그 자리에서 끊고, 기기 열쇠를 지워 다시 들어오려면 링크가 있어야 한다
#[tauri::command]
pub fn collab_kick(app: AppHandle, device: String) -> Res<Info> {
	with_hub(&app, |h| {
		h.book.lock().unwrap().remove_device(&device);
		for (d, tx) in h.conns.lock().unwrap().values() {
			if *d == device {
				let _ = tx.send(json!({ "t": "kicked" }).to_string());
				let _ = tx.send(CLOSE.into());
			}
		}
	})
}

/// 회의 잠금 — 켜면 새 기기가 들어오지 못한다
#[tauri::command]
pub fn collab_lock(app: AppHandle, on: bool) -> Res<Info> {
	with_hub(&app, |h| {
		h.book.lock().unwrap().locked = on;
	})
}

/// 바깥 길을 열거나 닫는다 — 깔린 Tailscale(Funnel) · cloudflared 를 쓴다 (tunnel.rs)
#[tauri::command]
pub async fn collab_tunnel(app: AppHandle, on: bool) -> Res<Info> {
	let h = hub(&app).ok_or("협업이 꺼져 있다")?;
	let mut slot = h.tunnel.lock().await;
	if let Some(t) = slot.take() {
		crate::tunnel::stop(t).await;
	}
	*h.public.lock().unwrap() = None;
	if on {
		let t = crate::tunnel::start(h.port).await?;
		*h.public.lock().unwrap() = Some((t.url.clone(), t.kind));
		*slot = Some(t);
	}
	drop(slot);
	let _ = h.app.emit("collab-info", h.info());
	Ok(h.info())
}

/// 바깥 길에 쓸 수 있는 도구 — 화면이 안내 글을 고른다
#[tauri::command]
pub async fn collab_tools() -> crate::tunnel::Tools {
	tokio::task::spawn_blocking(crate::tunnel::detect).await.unwrap_or(crate::tunnel::Tools { tailscale: None, cloudflared: None })
}

/// 연결 안에서만 쓰는 「끊어라」 표시 — 서버가 보내는 말과 겹치지 않는 글
const CLOSE: &str = "\u{0}close";

/// 끈다 — 붙어 있던 브라우저는 모두 끊긴다
#[tauri::command]
pub fn collab_stop(state: State<Collab>) {
	if let Some(tx) = state.stop.lock().unwrap().take() {
		let _ = tx.send(());
	}
	if let Some(h) = state.hub.lock().unwrap().take() {
		let _ = h.tx.send(json!({ "t": "bye" }).to_string().into());
		// 열린 WebSocket 을 닫는다 — 우아한 종료는 연결이 끝나기를 기다리고, 닫지 않으면 브라우저가 옛 서버에 붙은 채로 남아
		// 다시 켠 서버에 다시 붙지 못한다
		for (_, tx) in h.conns.lock().unwrap().values() {
			let _ = tx.send(CLOSE.into());
		}
		let h2 = h.clone();
		tauri::async_runtime::spawn(async move {
			if let Some(t) = h2.tunnel.lock().await.take() {
				crate::tunnel::stop(t).await;
			}
		});
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
		h.members.lock().unwrap().insert(0, Member { conn: 0, device: String::new(), name, slide, host: true, since: now() });
		h.members_changed();
	}
}

// ── HTTP ──

fn routes(h: Arc<Hub>) -> Router {
	Router::new()
		.route("/_/ws", get(ws))
		.route("/_/rpc", post(rpc))
		.route("/_/d/{key}/{*rest}", get(deck))
		.route("/__rt.js", get(deck_rt))
		.route("/j/{token}", get(join_page).post(join))
		.fallback(get(front))
		.layer(middleware::from_fn_with_state(h.clone(), auth))
		.layer(tower_http::compression::CompressionLayer::new())
		.with_state(h)
}

fn cookie_of(headers: &HeaderMap) -> Option<String> {
	let raw = headers.get(header::COOKIE)?.to_str().ok()?;
	raw.split(';').map(str::trim).find_map(|c| c.strip_prefix(&format!("{COOKIE}=")).map(String::from))
}


/// 기기 쿠키 검사. 찾은 기기를 요청에 붙인다(Who). 초대 링크 · 슬라이드 · 런타임은 저마다 따로 본다
async fn auth(Ax(h): Ax<Arc<Hub>>, mut req: Request, next: Next) -> Response {
	let path = req.uri().path();
	// 슬라이드는 주소 안 덱 열쇠로(처리기가 본다), 런타임은 누구에게나 같은 코드라 열쇠 없이, 초대 링크는 링크 열쇠로
	if path.starts_with("/_/d/") || path == "/__rt.js" || path.starts_with("/j/") {
		return next.run(req).await;
	}
	let public = h.public.lock().unwrap().as_ref().map(|(u, _)| u.clone());
	if (path == "/_/ws" || path == "/_/rpc") && !same_origin(req.headers(), public.as_deref()) {
		return StatusCode::FORBIDDEN.into_response();
	}
	let who = cookie_of(req.headers()).and_then(|c| h.book.lock().unwrap().device(&c, now())).map(|d| Who { device: d.id, name: d.name });
	match who {
		Some(w) => {
			req.extensions_mut().insert(w);
			next.run(req).await
		}
		None => page(StatusCode::UNAUTHORIZED, DENIED),
	}
}

fn page(status: StatusCode, html: &str) -> Response {
	(status, [(header::CONTENT_TYPE, "text/html; charset=utf-8")], html.to_string()).into_response()
}

/// 한국어 브라우저인가 — 초대 화면 글을 고른다
fn korean(headers: &HeaderMap) -> bool {
	headers.get(header::ACCEPT_LANGUAGE).and_then(|v| v.to_str().ok()).is_none_or(|l| l.trim_start().starts_with("ko"))
}

fn refused(headers: &HeaderMap, why: Why) -> Response {
	let ko = korean(headers);
	let msg = match (why, ko) {
		(Why::Expired, true) => "링크가 만료되었습니다. 호스트에게 새 링크를 받아 주세요.",
		(Why::Expired, false) => "This link has expired. Ask the host for a new one.",
		(Why::Locked, true) => "호스트가 회의를 잠갔습니다. 지금은 새로 들어올 수 없습니다.",
		(Why::Locked, false) => "The host locked the meeting. New people can't join right now.",
		(Why::Unknown, true) => "없는 링크입니다. 호스트에게 링크를 다시 받아 주세요.",
		(Why::Unknown, false) => "This link doesn't exist. Ask the host for the link again.",
	};
	page(StatusCode::FORBIDDEN, &format!("{HEAD}<p>{msg}</p>"))
}

const HEAD: &str = "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><title>ClaudePPT</title><style>body{font:15px system-ui,sans-serif;padding:48px;max-width:420px;margin:auto;color:#222}input,button{font:inherit;padding:8px 10px;border-radius:6px;border:1px solid #bbb}button{background:#222;color:#fff;border:0;margin-left:6px}</style><h2 style=\"font-size:18px\">ClaudePPT</h2>";

fn signed_in(secret: &str) -> Response {
	let mut r = Response::new(Body::empty());
	*r.status_mut() = StatusCode::SEE_OTHER;
	r.headers_mut().insert(header::LOCATION, HeaderValue::from_static("/"));
	// SameSite=Lax — 채팅 앱에서 링크를 눌러 들어온 첫 이동에도 붙어야 한다. 한 해 동안 기억한다(내보내면 서버에서 지운다)
	r.headers_mut().insert(header::SET_COOKIE, HeaderValue::from_str(&format!("{COOKIE}={secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000")).unwrap());
	r
}

/// 초대 링크를 열었다 — 이미 들어온 기기면 바로 화면으로, 개인 링크면 그 이름으로 들어오고, 공용 링크면 이름을 묻는다
async fn join_page(Ax(h): Ax<Arc<Hub>>, axum::extract::Path(token): axum::extract::Path<String>, headers: HeaderMap) -> Response {
	if cookie_of(&headers).is_some_and(|c| h.book.lock().unwrap().device(&c, now()).is_some()) {
		let mut r = Response::new(Body::empty());
		*r.status_mut() = StatusCode::SEE_OTHER;
		r.headers_mut().insert(header::LOCATION, HeaderValue::from_static("/"));
		return r;
	}
	let link = match h.book.lock().unwrap().link(&token, now()) {
		Ok(l) => l.clone(),
		Err(why) => return refused(&headers, why),
	};
	if link.name.is_some() {
		let (_, secret) = h.book.lock().unwrap().join(&link, "", now());
		h.book_changed();
		return signed_in(&secret);
	}
	let (q, ph, go) = if korean(&headers) { ("들어가기 전에 이름을 적어 주세요. 요청 · 고친 것에 이 이름이 남습니다.", "이름", "들어가기") } else { ("Enter your name before joining. It is shown on your requests and edits.", "Name", "Join") };
	page(StatusCode::OK, &format!("{HEAD}<p>{q}</p><form method=post><input name=name placeholder=\"{ph}\" maxlength=40 required autofocus><button>{go}</button></form>"))
}

#[derive(serde::Deserialize)]
struct JoinForm {
	name: String,
}

/// 공용 링크에서 이름을 적고 들어온다
async fn join(Ax(h): Ax<Arc<Hub>>, axum::extract::Path(token): axum::extract::Path<String>, headers: HeaderMap, axum::Form(f): axum::Form<JoinForm>) -> Response {
	let link = match h.book.lock().unwrap().link(&token, now()) {
		Ok(l) => l.clone(),
		Err(why) => return refused(&headers, why),
	};
	if invite::clean_name(&f.name).is_empty() {
		return join_page(Ax(h), axum::extract::Path(token), headers).await;
	}
	let (_, secret) = h.book.lock().unwrap().join(&link, &f.name, now());
	h.book_changed();
	signed_in(&secret)
}

const DENIED: &str = "<!doctype html><meta charset=utf-8><title>ClaudePPT</title><body style=\"font:15px system-ui;padding:40px\"><p>초대 링크로 들어와 주세요. 호스트에게 링크를 받아 주세요.</p><p>Please open the invite link. Ask the host for one.</p>";

/// 요청을 보낸 페이지가 이 서버에서 온 것인가 — Origin 의 호스트:포트가 Host 와 같아야 한다.
/// 브라우저는 WebSocket 연결과 POST fetch 에 늘 Origin 을 붙인다. sandbox 슬라이드는 「null」이라 걸린다
/// 바깥 길로 온 요청은 터널이 Host 를 127.0.0.1 로 바꿔 보낼 수 있다 — 그래서 바깥 길 주소(public)와 같은 Origin 도 받는다
fn same_origin(headers: &HeaderMap, public: Option<&str>) -> bool {
	let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else { return false };
	if public.is_some_and(|p| p.trim_end_matches('/').eq_ignore_ascii_case(origin)) {
		return true;
	}
	let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) else { return false };
	origin.split_once("://").is_some_and(|(_, h)| h.eq_ignore_ascii_case(host))
}

/// 내용으로 만든 ETag (FNV-1a 64)
fn etag(bytes: &[u8]) -> String {
	let mut x: u64 = 0xcbf29ce484222325;
	for b in bytes {
		x ^= *b as u64;
		x = x.wrapping_mul(0x100000001b3);
	}
	format!("\"{x:016x}\"")
}

/// 캐시 머리글 — immutable 이면 한 해 동안 다시 묻지 않고, 아니면 매번 ETag 로 묻는다(바뀌지 않았으면 304)
fn cached(mut r: Response, immutable: bool) -> Response {
	let v = if immutable { "public, max-age=31536000, immutable" } else { "no-cache" };
	r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(v));
	r
}

async fn deck(Ax(h): Ax<Arc<Hub>>, axum::extract::Path((key, _)): axum::extract::Path<(String, String)>, headers: HeaderMap, uri: Uri) -> Response {
	if !same(&key, &h.deck_key) {
		return StatusCode::UNAUTHORIZED.into_response();
	}
	let rest = uri.path()["/_/d/".len() + key.len()..].to_string();
	let r = crate::serve(&h.app, &rest);
	if r.status() != StatusCode::OK {
		return r.map(Body::from);
	}
	// 판 고정 주소(<id>@<커밋>/…)는 바뀌지 않는다
	let pinned = rest.trim_start_matches('/').split('/').next().is_some_and(|head| head.contains('@'));
	let html = r.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|c| c.starts_with("text/html"));
	let tag = etag(r.body());
	if !pinned && headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) == Some(tag.as_str()) {
		let mut nm = Response::new(Body::empty());
		*nm.status_mut() = StatusCode::NOT_MODIFIED;
		nm.headers_mut().insert(header::ETAG, HeaderValue::from_str(&tag).unwrap());
		return cached(nm, false);
	}
	let mut r = r.map(Body::from);
	let hd = r.headers_mut();
	// sandbox 슬라이드(출처 없음)가 글꼴 · 그림을 읽으려면 필요하다. 덱 열쇠가 곧 허락이라 쿠키를 쓰지 않는다
	hd.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
	hd.insert(header::ETAG, HeaderValue::from_str(&tag).unwrap());
	if html {
		hd.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("connect-src 'none'; form-action 'none'; base-uri 'self'; object-src 'none'"));
	}
	cached(r, pinned)
}

async fn deck_rt(Ax(h): Ax<Arc<Hub>>) -> Response {
	let mut r = crate::serve(&h.app, "/__rt.js").map(Body::from);
	r.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
	cached(r, false)
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
		// Vite 가 이름에 내용 해시를 붙인 파일(/assets/…)은 바뀌지 않는다. index.html 은 새 판에서 바뀐다
		Some(a) => cached((StatusCode::OK, [(header::CONTENT_TYPE, a.mime_type)], a.bytes).into_response(), path.starts_with("/assets/")),
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

async fn ws(Ax(h): Ax<Arc<Hub>>, axum::Extension(who): axum::Extension<Who>, up: WebSocketUpgrade) -> Response {
	up.on_upgrade(move |s| conn(h, who, s))
}

async fn conn(h: Arc<Hub>, who: Who, mut socket: WebSocket) {
	let id = h.next.fetch_add(1, Ordering::SeqCst);
	let (direct, mut inbox) = mpsc::unbounded_channel::<String>();
	let mut rx = h.tx.subscribe();
	h.conns.lock().unwrap().insert(id, (who.device.clone(), direct.clone()));
	h.members.lock().unwrap().insert(id, Member { conn: id, device: who.device.clone(), name: who.name.clone(), slide: None, host: false, since: now() });
	h.members_changed();
	let hello = json!({ "t": "hello", "conn": id, "deckKey": h.deck_key, "name": who.name }).to_string();
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
			d = inbox.recv() => match d {
				Some(s) if s == CLOSE => { let _ = socket.send(Message::Close(None)).await; break; }
				Some(s) => { if socket.send(Message::Text(s.into())).await.is_err() { break; } }
				None => break,
			},
		}
	}
	h.conns.lock().unwrap().remove(&id);
	if h.members.lock().unwrap().remove(&id).is_some() {
		h.members_changed();
	}
	let _ = h.app.emit("collab-info", h.info());
}

fn on_message(h: &Arc<Hub>, conn: u64, direct: &mpsc::UnboundedSender<String>, text: &str) {
	let Ok(m) = serde_json::from_str::<Value>(text) else { return };
	match m["t"].as_str().unwrap_or("") {
		// 이름 · 보는 쪽 — 들어올 때와 쪽을 옮길 때
		// 보는 쪽 — 이름은 서버가 정한 기기 이름 그대로 (브라우저가 보낸 이름은 쓰지 않는다)
		"hello" | "view" => {
			let slide = m["slide"].as_str().map(String::from);
			if let Some(e) = h.members.lock().unwrap().get_mut(&conn) {
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
			let (who, device) = h.members.lock().unwrap().get(&conn).map(|x| (x.name.clone(), x.device.clone())).unwrap_or_default();
			let key = uuid::Uuid::new_v4().simple().to_string();
			let (tx, rx) = oneshot::channel();
			h.pending.lock().unwrap().insert(key.clone(), tx);
			let sent = h.app.emit("collab-intent", json!({ "id": key, "from": { "conn": conn, "name": who, "device": device }, "name": name, "args": m["args"] }));
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
	fn reads_cookie() {
		let mut h = HeaderMap::new();
		h.insert(header::COOKIE, HeaderValue::from_static("a=1; cppt_d=tok; b=2"));
		assert_eq!(cookie_of(&h).as_deref(), Some("tok"));
	}

	#[test]
	fn origin_must_match_host() {
		let h = |origin: Option<&'static str>, host: &'static str| {
			let mut m = HeaderMap::new();
			if let Some(o) = origin {
				m.insert(header::ORIGIN, HeaderValue::from_static(o));
			}
			m.insert(header::HOST, HeaderValue::from_static(host));
			same_origin(&m, None)
		};
		assert!(h(Some("http://10.0.0.5:47815"), "10.0.0.5:47815"));
		assert!(h(Some("https://abc.ts.net"), "abc.ts.net"));
		assert!(!h(Some("http://10.0.0.5:8080"), "10.0.0.5:47815"), "같은 PC 다른 포트");
		assert!(!h(Some("null"), "10.0.0.5:47815"), "sandbox 슬라이드");
		assert!(!h(Some("https://evil.example"), "10.0.0.5:47815"));
		assert!(!h(None, "10.0.0.5:47815"));
		// 바깥 길: Host 가 127.0.0.1 로 바뀌어 와도 터널 주소와 같은 Origin 은 받는다
		let mut m = HeaderMap::new();
		m.insert(header::ORIGIN, HeaderValue::from_static("https://plain-dog.trycloudflare.com"));
		m.insert(header::HOST, HeaderValue::from_static("127.0.0.1:47815"));
		assert!(same_origin(&m, Some("https://plain-dog.trycloudflare.com")));
		assert!(!same_origin(&m, Some("https://other.trycloudflare.com")));
		assert!(!same_origin(&m, None));
	}

	#[test]
	fn etag_follows_content() {
		assert_eq!(etag(b"a"), etag(b"a"));
		assert_ne!(etag(b"a"), etag(b"b"));
		assert!(etag(b"").starts_with('"') && etag(b"").ends_with('"'));
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
