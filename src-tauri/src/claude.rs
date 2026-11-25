// Claude Code CLI 를 헤드리스로 돌려 대화 한 턴을 실행한다. 출력(stream-json)은 줄마다 「claude」 사건으로 화면에 넘긴다.
//
// 격리 — 이 앱의 Claude 는 사용자의 다른 Claude 설정에 영향을 받지 않는다. 화면이 바꿀 수 없게 인자를 여기에 고정한다.
//   --safe-mode              CLAUDE.md · 스킬 · 플러그인 · 훅 · MCP · 출력 스타일을 끈다
//   --setting-sources ""     사용자 · 프로젝트 settings.json 도 읽지 않는다. --safe-mode 만으로는 응답 언어 같은
//                            사용자 설정이 남는다 (2026.11.17 CLI 2.1.325 실측: 없으면 영어 질문에 한국어로 답했다)
//   --system-prompt-file     기본 시스템 프롬프트를 이 앱의 프롬프트로 바꾼다 (화면 「설정 › Claude」에서 고친다)
//   --tools                  파일 읽기 · 쓰기만. 셸 · 웹은 주지 않는다 — 프로젝트 폴더 밖을 건드릴 길을 막는다
//                            단 「글꼴 찾기」(mode = "fonts")는 거꾸로 웹 찾기 · 웹 읽기만 주고 파일은 못 건드린다.
//                            받아서 까는 일은 Claude 가 아니라 앱(fonts::font_install)이 한다 — 받은 것이 글꼴인지 앱이 가린다
//   --permission-prompts none 물어볼 일이 생기면 기다리지 않고 거절한다 (헤드리스라 답할 사람이 없다)
// 구독 로그인(OAuth)은 그대로 쓴다. --bare 는 API 키만 받아 쓰지 않는다.

use crate::{AppState, Res, err};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const TOOLS: &str = "Read,Edit,Write,Glob,Grep";
const FONT_TOOLS: &str = "WebSearch,WebFetch";

#[derive(Serialize)]
pub struct Detected {
	path: String,
	version: String,
}

/// claude 실행 파일을 찾는다. npm 으로 깐 경우 claude.cmd 옆 node_modules 안의 claude.exe 를 바로 쓴다 —
/// cmd 를 거치면 빈 인자("")와 따옴표가 깨진다.
pub fn resolve(custom: &str) -> Option<PathBuf> {
	if !custom.trim().is_empty() {
		let p = PathBuf::from(custom.trim());
		return p.exists().then_some(p);
	}
	let mut c = std::process::Command::new("where");
	crate::hidden(&mut c);
	let out = c.arg("claude").output().ok()?;
	let text = String::from_utf8_lossy(&out.stdout).to_string();
	let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
	if let Some(exe) = lines.iter().find(|l| l.to_ascii_lowercase().ends_with(".exe")) {
		return Some(PathBuf::from(exe));
	}
	for l in &lines {
		if l.to_ascii_lowercase().ends_with(".cmd") {
			let exe = Path::new(l).parent()?.join("node_modules/@anthropic-ai/claude-code/bin/claude.exe");
			if exe.exists() {
				return Some(exe);
			}
		}
	}
	None
}

#[tauri::command]
pub async fn claude_detect(path: String) -> Res<Option<Detected>> {
	let Some(exe) = resolve(&path) else { return Ok(None) };
	let mut c = tokio::process::Command::new(&exe);
	c.arg("--version");
	#[cfg(windows)]
	c.creation_flags(0x0800_0000);
	let out = c.output().await.map_err(err)?;
	Ok(Some(Detected { path: exe.to_string_lossy().into(), version: String::from_utf8_lossy(&out.stdout).trim().to_string() }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSpec {
	turn: String,
	dir: String,
	prompt: String,
	system: String,
	claude_path: String,
	model: String,
	effort: String,
	resume: Option<String>,
	/// 새 세션의 id — 앱이 정해 --session-id 로 준다. 그래야 턴이 멈춰 init 사건을 못 받아도 그 세션의 기록을 찾아 남긴다
	session_id: Option<String>,
	/// None 이면 쪽 고치기. "fonts" 면 글꼴 찾기 (위 머리말)
	mode: Option<String>,
}

// ── 세션 기록 지키기 ──
// Claude Code 는 세션 기록을 <설정 폴더>/projects/<작업 폴더 이름>/<세션 id>.jsonl 에 둔다. --resume 은 거기서만 찾는다.
// 덱 폴더를 옮기거나(.cppt 로 다른 PC 에 풀거나) 기록을 지우면 「No conversation found」로 이어 쓰지 못하고, 장표에 붙은 세션의 맥락이 끊긴다.
// 그래서 턴이 끝날 때마다 덱의 .claudeppt/sessions/<id>.jsonl 로 복사해 두고, 이어 쓰기 전에 claude 쪽에 없으면 되돌려 놓는다.
// (.claudeppt 는 판에 들지 않고 .cppt 에는 든다 — 대화 기록 talk.json 과 같은 자리)

/// 세션 id 는 화면에서 온다 — 경로에 쓰므로 uuid 꼴만 받는다
fn valid_sid(s: &str) -> bool {
	!s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn projects_root() -> Option<PathBuf> {
	std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).or_else(|| dirs::home_dir().map(|h| h.join(".claude"))).map(|d| d.join("projects"))
}

/// 작업 폴더 → projects 아래 폴더 이름. 영문 · 숫자가 아닌 글자는 UTF-16 한 단위마다 「-」 (「문서」 → 「--」).
/// 2026.11.25 CLI 2.1.x 실측: C:\Users\me\OneDrive\문서\ClaudePPT\제목 없음 → C--Users-me-OneDrive----ClaudePPT------
fn project_key(dir: &Path) -> String {
	dir.to_string_lossy().encode_utf16().map(|u| if u < 128 && (u as u8).is_ascii_alphanumeric() { u as u8 as char } else { '-' }).collect()
}

fn backup_path(dir: &Path, sid: &str) -> PathBuf {
	dir.join(".claudeppt").join("sessions").join(format!("{sid}.jsonl"))
}

/// claude 쪽의 그 세션 기록 — 이 작업 폴더 자리에 없으면 다른 폴더(덱을 옮기기 전 자리)에서도 찾는다
fn live_transcript(root: &Path, dir: &Path, sid: &str) -> Option<PathBuf> {
	let here = root.join(project_key(dir)).join(format!("{sid}.jsonl"));
	if here.is_file() {
		return Some(here);
	}
	std::fs::read_dir(root).ok()?.flatten().map(|e| e.path().join(format!("{sid}.jsonl"))).find(|p| p.is_file())
}

/// 이어 쓰기 전에 — 이 작업 폴더 자리에 기록이 없으면 다른 자리의 것이나 덱에 남긴 것을 놓는다
fn restore_transcript(root: &Path, dir: &Path, sid: &str) {
	let key = project_key(dir);
	// 아주 긴 경로는 Claude Code 가 이름을 줄이고 해시를 붙인다 — 그 이름을 모르므로 놓지 않는다 (claude 가 못 찾으면 화면이 요약으로 새로 잇는다)
	if !valid_sid(sid) || key.len() > 200 {
		return;
	}
	let here = root.join(&key).join(format!("{sid}.jsonl"));
	if here.is_file() {
		return;
	}
	let src = live_transcript(root, dir, sid).or_else(|| Some(backup_path(dir, sid)).filter(|p| p.is_file()));
	if let Some(src) = src {
		let _ = std::fs::create_dir_all(here.parent().unwrap());
		let _ = std::fs::copy(src, &here);
	}
}

/// 턴이 끝난 뒤 — claude 쪽 기록을 덱에 남긴다
fn backup_transcript(root: &Path, dir: &Path, sid: &str) {
	if !valid_sid(sid) {
		return;
	}
	if let Some(src) = live_transcript(root, dir, sid) {
		let to = backup_path(dir, sid);
		let _ = std::fs::create_dir_all(to.parent().unwrap());
		let _ = std::fs::copy(src, to);
	}
}

#[derive(Serialize, Clone)]
struct Line {
	turn: String,
	line: String,
}

#[derive(Serialize, Clone)]
pub struct Done {
	turn: String,
	code: i32,
	stderr: String,
}

#[tauri::command]
pub async fn claude_run(app: AppHandle, state: State<'_, AppState>, spec: RunSpec) -> Res<Done> {
	let exe = resolve(&spec.claude_path).ok_or("claude 실행 파일을 찾지 못했다 — 설정 › Claude 에서 경로를 준다")?;
	let dir = PathBuf::from(&spec.dir);
	let run_dir = dir.join(".claudeppt/run");
	std::fs::create_dir_all(&run_dir).map_err(err)?;
	let sys_file = run_dir.join("system.md");
	std::fs::write(&sys_file, &spec.system).map_err(err)?;

	let fonts = spec.mode.as_deref() == Some("fonts");
	let mut args: Vec<String> = [
		"-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
		"--safe-mode", "--setting-sources", "",
		"--strict-mcp-config", "--disable-slash-commands",
		"--tools", if fonts { FONT_TOOLS } else { TOOLS },
		"--permission-mode", "acceptEdits", "--permission-prompts", "none",
	]
	.map(String::from)
	.to_vec();
	if fonts {
		// 웹 도구는 acceptEdits 로 허락되지 않는다 — 물어볼 사람이 없으니 미리 허락해 둔다
		args.extend(["--allowedTools".into(), FONT_TOOLS.into()]);
	}
	args.extend(["--system-prompt-file".into(), sys_file.to_string_lossy().into()]);
	if !spec.model.trim().is_empty() {
		args.extend(["--model".into(), spec.model.trim().into()]);
	}
	if !spec.effort.trim().is_empty() {
		args.extend(["--effort".into(), spec.effort.trim().into()]);
	}
	let root = projects_root();
	let resume = spec.resume.as_deref().filter(|s| !s.is_empty());
	if let Some(sid) = resume {
		if let Some(r) = &root {
			restore_transcript(r, &dir, sid);
		}
		args.extend(["--resume".into(), sid.into()]);
	} else if let Some(sid) = spec.session_id.as_deref().filter(|s| valid_sid(s)) {
		args.extend(["--session-id".into(), sid.into()]);
	}

	let mut cmd = tokio::process::Command::new(&exe);
	cmd.current_dir(&dir).args(&args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
	#[cfg(windows)]
	cmd.creation_flags(0x0800_0000);
	let mut child = cmd.spawn().map_err(|e| format!("claude 를 띄우지 못했다: {e}"))?;
	if let Some(pid) = child.id() {
		state.runs.lock().unwrap().insert(spec.turn.clone(), pid);
	}
	let mut stdin = child.stdin.take().unwrap();
	stdin.write_all(spec.prompt.as_bytes()).await.map_err(err)?;
	drop(stdin);

	let stdout = child.stdout.take().unwrap();
	let stderr = child.stderr.take().unwrap();
	let turn = spec.turn.clone();
	let app2 = app.clone();
	let err_task = tokio::spawn(async move {
		let mut s = String::new();
		let mut r = BufReader::new(stderr).lines();
		while let Ok(Some(l)) = r.next_line().await {
			if s.len() < 8000 {
				s.push_str(&l);
				s.push('\n');
			}
		}
		s
	});
	let mut lines = BufReader::new(stdout).lines();
	// 이 턴이 쓴 세션 id — 남길 기록을 찾는 데 쓴다. 이어 쓰기 · 새 id 를 준 경우가 아니면 init 사건에서 읽는다
	let mut sid = resume.map(String::from).or_else(|| spec.session_id.clone().filter(|s| valid_sid(s)));
	while let Ok(Some(line)) = lines.next_line().await {
		if sid.is_none() && line.contains("\"subtype\":\"init\"") {
			sid = serde_json::from_str::<serde_json::Value>(&line).ok().and_then(|v| v["session_id"].as_str().map(String::from));
		}
		let _ = app2.emit("claude", Line { turn: turn.clone(), line });
	}
	let status = child.wait().await.map_err(err)?;
	let stderr = err_task.await.unwrap_or_default();
	if let (Some(r), Some(s)) = (&root, &sid) {
		backup_transcript(r, &dir, s);
	}
	// 시스템 프롬프트를 덱 폴더에 남기지 않는다 — claude 는 시작할 때 한 번 읽고 끝이다
	let _ = std::fs::remove_file(&sys_file);
	app.state::<AppState>().runs.lock().unwrap().remove(&turn);
	Ok(Done { turn, code: status.code().unwrap_or(-1), stderr })
}

use tauri::Manager;

#[tauri::command]
pub fn claude_stop(state: State<AppState>, turn: String) -> Res<()> {
	if let Some(pid) = state.runs.lock().unwrap().remove(&turn) {
		let mut c = std::process::Command::new("taskkill");
		crate::hidden(&mut c);
		let _ = c.args(["/PID", &pid.to_string(), "/T", "/F"]).status();
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn project_key_matches_claude_code() {
		// ~/.claude/projects 에 실제로 생긴 이름 (2026.11.25 CLI 2.1.299)
		assert_eq!(project_key(Path::new(r"C:\Users\eunch\OneDrive\문서\ClaudePPT\제목 없음")), "C--Users-eunch-OneDrive----ClaudePPT------");
		assert_eq!(project_key(Path::new(r"c:\project\claudeppt")), "c--project-claudeppt");
		// UTF-16 둘로 된 글자(이모지)는 「-」 둘
		assert_eq!(project_key(Path::new("a😀b")), "a--b");
	}

	#[test]
	fn session_id_must_look_like_uuid() {
		assert!(valid_sid("0f8c2a6e-1b2c-4d5e-8f90-123456789abc"));
		for bad in ["", "../x", r"..\..\x", "a/b", "id with space", &"a".repeat(65)] {
			assert!(!valid_sid(bad), "{bad}");
		}
	}

	#[test]
	fn transcript_is_backed_up_and_restored() {
		let t = std::env::temp_dir().join(format!("cppt-claude-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&t);
		let root = t.join("projects");
		let deck = t.join("덱 하나");
		let moved = t.join("옮긴 덱");
		let sid = "0f8c2a6e-1b2c-4d5e-8f90-123456789abc";
		std::fs::create_dir_all(root.join(project_key(&deck))).unwrap();
		std::fs::create_dir_all(&deck).unwrap();
		std::fs::write(root.join(project_key(&deck)).join(format!("{sid}.jsonl")), "{\"a\":1}\n").unwrap();

		// 턴이 끝나면 덱에 남는다
		backup_transcript(&root, &deck, sid);
		assert_eq!(std::fs::read_to_string(backup_path(&deck, sid)).unwrap(), "{\"a\":1}\n");

		// 덱을 옮기면 (같은 PC) 옛 자리의 기록을 새 자리에 놓는다
		std::fs::create_dir_all(&moved).unwrap();
		restore_transcript(&root, &moved, sid);
		assert!(root.join(project_key(&moved)).join(format!("{sid}.jsonl")).is_file());

		// claude 쪽 기록이 모두 없어도 (다른 PC · 지움) 덱에 남긴 것으로 되돌린다
		std::fs::remove_dir_all(&root).unwrap();
		restore_transcript(&root, &deck, sid);
		assert_eq!(std::fs::read_to_string(root.join(project_key(&deck)).join(format!("{sid}.jsonl"))).unwrap(), "{\"a\":1}\n");

		// 이미 있으면 덮지 않는다 (claude 쪽이 더 새것)
		std::fs::write(root.join(project_key(&deck)).join(format!("{sid}.jsonl")), "newer\n").unwrap();
		restore_transcript(&root, &deck, sid);
		assert_eq!(std::fs::read_to_string(root.join(project_key(&deck)).join(format!("{sid}.jsonl"))).unwrap(), "newer\n");

		// 이상한 id 는 경로에 쓰지 않는다
		restore_transcript(&root, &deck, "../../evil");
		backup_transcript(&root, &deck, "../../evil");
		assert!(!t.join("evil.jsonl").exists());
		let _ = std::fs::remove_dir_all(&t);
	}
}
