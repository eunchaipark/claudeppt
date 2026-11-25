// ClaudePPT 백엔드 — 화면(React)이 부르는 명령과 슬라이드를 내주는 deck:// 프로토콜.
//
// 목차
//   AppState            열린 프로젝트(id → 폴더) · 감시기 · 실행 중인 Claude
//   deck:// 프로토콜     슬라이드 HTML 에 런타임(rt.js)을 끼워 내준다 · <id>@<커밋> 이면 그 판의 파일을 git 에서 꺼낸다
//   명령                 fs · project · vcs · claude · image · ppt 모듈에 있다
//   팀 협업              collab.rs — 「설정 › 협업」을 켜면 브라우저 팀원에게 화면 · 슬라이드 · 상태를 내주는 서버 (기본 꺼짐)
//   바깥 제어            control.rs — 앱 밖 Claude Code 가 CLI(cli.rs · 같은 실행 파일에 인자를 주어 부른다)로 앱을 부리는 통로

pub mod cli;
mod claude;
mod collab;
mod control;
mod fonts;
mod fsx;
mod imagegen;
mod invite;
mod metafile;
mod project;
mod pptsnap;
mod vcs;
mod tunnel;
mod watch;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri::http::{Response, StatusCode};

/// 슬라이드마다 끼워 넣는 런타임. 핫 리로드 · 핀 위치 찾기 · 직접 편집 · PPTX 좌표 뽑기를 맡는다.
const RUNTIME_JS: &str = include_str!("../runtime/rt.js");

#[derive(Default)]
pub struct AppState {
	/// 프로젝트 id → 폴더. deck:// 주소의 첫 마디가 이 id 다.
	pub projects: Mutex<HashMap<String, PathBuf>>,
	pub watchers: Mutex<HashMap<String, watch::Handle>>,
	/// 대화 턴 id → 실행 중인 claude 의 pid. 멈출 때 프로세스 트리째 끈다.
	pub runs: Mutex<HashMap<String, u32>>,
}

pub fn run() {
	tauri::Builder::default()
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_updater::Builder::new().build())
		.plugin(tauri_plugin_process::init())
		.manage(AppState::default())
		.manage(control::Control::new())
		.manage(collab::Collab::default())
		.setup(|app| {
			// 통로를 못 열어도 앱은 그대로 쓴다 — 바깥 제어만 안 된다
			if let Err(e) = control::start(app.handle()) {
				eprintln!("제어 통로를 열지 못했다: {e}");
			}
			Ok(())
		})
		.register_asynchronous_uri_scheme_protocol("deck", |ctx, req, responder| {
			let app = ctx.app_handle().clone();
			std::thread::spawn(move || responder.respond(serve(&app, req.uri().path())));
		})
		.invoke_handler(tauri::generate_handler![
			fsx::fs_read_text,
			fsx::clip_text,
			fsx::fs_write_text,
			fsx::fs_write_base64,
			fsx::fs_exists,
			fsx::fs_write_bytes,
			fsx::abs_read_bytes,
			fsx::abs_copy_in,
			fsx::abs_write_bytes,
			project::app_paths,
			project::settings_load,
			project::settings_save,
			project::project_open,
			project::project_close,
			project::library_list,
			project::pack_deck,
			project::unpack_deck,
			project::reveal,
			vcs::vcs_init,
			vcs::vcs_commit,
			vcs::vcs_log,
			vcs::vcs_tag,
			vcs::vcs_restore,
			claude::claude_detect,
			claude::claude_run,
			claude::claude_stop,
			imagegen::tools_detect,
			imagegen::image_generate,
			pptsnap::ppt_snapshot,
			metafile::metafile_png,
			fonts::font_index,
			fonts::font_install,
			control::remote_ready,
			control::remote_reply,
			control::remote_info,
			control::remote_set_enabled,
			control::skill_install,
			collab::collab_start,
			collab::collab_stop,
			collab::collab_info,
			collab::collab_publish,
			collab::collab_reply,
			collab::collab_view,
			collab::collab_link_new,
			collab::collab_link_remove,
			collab::collab_kick,
			collab::collab_lock,
			collab::collab_tunnel,
			collab::collab_tools,
		])
		.build(tauri::generate_context!())
		.expect("앱을 띄우지 못했다")
		.run(|_, e| {
			if let tauri::RunEvent::Exit = e {
				control::forget();
			}
		});
}

/// deck://localhost/<id>[@<커밋>]/<경로>
fn serve(app: &tauri::AppHandle, raw: &str) -> Response<Vec<u8>> {
	let path = percent_decode(raw);
	let path = path.trim_start_matches('/');
	if path == "__rt.js" {
		return ok("text/javascript", RUNTIME_JS.as_bytes().to_vec());
	}
	let (head, rel) = path.split_once('/').unwrap_or((path, ""));
	let (id, rev) = match head.split_once('@') {
		Some((i, r)) => (i, Some(r)),
		None => (head, None),
	};
	let Some(root) = app.state::<AppState>().projects.lock().unwrap().get(id).cloned() else {
		return status(StatusCode::NOT_FOUND);
	};
	// 슬라이드 안 스크립트가 ..\ · %5C · 절대 경로로 프로젝트 밖 파일을 읽지 못하게 — fs 명령과 같은 검사를 쓴다
	let Ok(full) = fsx::inside(&root.to_string_lossy(), rel) else { return status(StatusCode::FORBIDDEN) };
	let bytes = match rev {
		Some(r) => vcs::show_file(&root, r, &rel.replace('\\', "/")),
		None => std::fs::read(full).ok(),
	};
	let Some(mut bytes) = bytes else { return status(StatusCode::NOT_FOUND) };
	let mime = mime_of(rel);
	if mime == "text/html" {
		bytes = inject_runtime(&bytes);
	}
	ok(mime, bytes)
}

/// 런타임 스크립트는 파일에 쓰지 않고 내줄 때만 붙인다 — Claude 가 고치는 원본을 깨끗하게 두고,
/// 직접 편집으로 다시 쓸 때도 섞여 들어가지 않게.
fn inject_runtime(html: &[u8]) -> Vec<u8> {
	let text = String::from_utf8_lossy(html);
	let tag = "<script src=\"/__rt.js\"></script>";
	let lower = text.to_ascii_lowercase();
	match lower.rfind("</body>") {
		Some(at) => format!("{}{}{}", &text[..at], tag, &text[at..]).into_bytes(),
		None => format!("{text}{tag}").into_bytes(),
	}
}

fn mime_of(rel: &str) -> &'static str {
	let ext = rel.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
	match ext.as_str() {
		"html" | "htm" => "text/html",
		"css" => "text/css",
		"js" | "mjs" => "text/javascript",
		"json" => "application/json",
		"svg" => "image/svg+xml",
		"png" => "image/png",
		"jpg" | "jpeg" => "image/jpeg",
		"gif" => "image/gif",
		"webp" => "image/webp",
		"woff2" => "font/woff2",
		"woff" => "font/woff",
		"ttf" => "font/ttf",
		"otf" => "font/otf",
		_ => "application/octet-stream",
	}
}

fn ok(mime: &str, body: Vec<u8>) -> Response<Vec<u8>> {
	Response::builder()
		.header("Content-Type", format!("{mime}; charset=utf-8"))
		.header("Cache-Control", "no-store")
		.header("Access-Control-Allow-Origin", "*")
		.body(body)
		.unwrap()
}

fn status(s: StatusCode) -> Response<Vec<u8>> {
	Response::builder().status(s).body(Vec::new()).unwrap()
}

fn percent_decode(s: &str) -> String {
	let b = s.as_bytes();
	let mut out = Vec::with_capacity(b.len());
	let mut i = 0;
	while i < b.len() {
		if b[i] == b'%' && i + 2 < b.len() {
			if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
				out.push(v);
				i += 3;
				continue;
			}
		}
		out.push(b[i]);
		i += 1;
	}
	String::from_utf8_lossy(&out).into_owned()
}

/// 창 없이 자식 프로세스를 띄운다 (Windows 에서 콘솔 창이 번쩍이지 않게).
pub fn hidden(cmd: &mut std::process::Command) -> &mut std::process::Command {
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		cmd.creation_flags(0x0800_0000);
	}
	cmd
}

pub type Res<T> = Result<T, String>;

pub fn err<E: std::fmt::Display>(e: E) -> String {
	e.to_string()
}
