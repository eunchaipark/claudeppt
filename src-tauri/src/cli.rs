// CLI — 같은 실행 파일에 명령 인자를 주면 창 없이 명령으로 돈다 (main.rs). 앱 밖 Claude Code 가 스킬 「claudeppt」로 부른다.
//
// 목차
//   명령 표          COMMANDS · HELP
//   인자 · 경로      Args · fix_path (Git Bash 의 /d/… 꼴도 받는다)
//   덱 찾기          deck_dir · deck_own — --deck · 지금 폴더에서 위로 · 앱에 열린 덱 순서. 덱을 바꾸는 명령은 앱에 열린 덱으로 떨어지지 않는다
//   앱 없이 하는 일   list · info · log · commit · restore · pack · unpack · paths · add · remove · move — 파일과 git 만 본다
//   스킬 깔기        skill — 스킬 「claudeppt」(저장소 skill/SKILL.md 를 실행 파일에 담아 둔다)와 cppt 꾸러미를 ~/.claude/skills 에 쓴다
//   앱에 넘기는 일    status · open · new · import · export · shot · inspect · check · release · style · pins · gen
//                    웹뷰가 쪽을 그려야 하거나 앱 설정 · 앱이 쥔 상태(핀)를 써야 하는 일이라 실행 중인 앱에 넘긴다 (control.rs → src/lib/remote.ts)
//   앱 부르기        call — control.json 으로 찾아 붙고, 꺼져 있으면 띄운 뒤 준비될 때까지 기다린다
//   바깥 작업 알림    touch — 덱을 쓴 명령마다 켜진 앱에 알린다. 앱은 몇 분 동안 그 덱에서 앱 안 Claude 에게 보내기 전에 한 번 묻는다
//
// 출력은 늘 stdout 에 JSON 하나다 — 에이전트가 그대로 읽는다. 실패면 {"ok":false,"error":…} 와 종료 코드 1.
// 덱을 쓴 명령은 봉투에 "deck"(쓴 덱 폴더)을 단다 — 엉뚱한 덱을 다룬 것을 에이전트가 바로 알아채게.
// 쪽 번호는 1부터 센다 (deck.json 의 slides 순서). 앱 안의 「@3」 과 같은 번호다.

use crate::{control, project, vcs};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

type R<T> = Result<T, String>;

const COMMANDS: &[&str] = &[
	"help", "skill", "paths", "status", "list", "info", "log", "commit", "restore", "pack", "unpack", "add", "remove", "move",
	"launch", "open", "new", "import", "export", "shot", "inspect", "check", "release", "style", "pins", "gen",
];

const HELP: &str = "ClaudePPT CLI — 출력은 JSON 하나. 쪽 번호는 1부터.

덱 고르기 (모든 명령 공통): --deck <폴더 | deck.json | 저장 폴더 안 폴더 이름 | 덱 제목>
  주지 않으면 지금 폴더에서 위로 deck.json 을 찾고, 없으면 앱에 열린 덱을 쓴다.
  덱을 바꾸는 명령(commit · restore · add · remove · move · gen · release · pins --done)은 앱에 열린 덱으로 넘겨짚지 않는다.
  출력의 \"deck\" 이 실제로 쓴 덱이다.

앱 없이
  skill [--to <폴더>]                Claude Code 스킬 「claudeppt」를 설치한다 (기본 ~/.claude/skills/claudeppt)
  paths                              저장 폴더 · 앱 데이터 · 실행 파일 위치
  list                               저장 폴더의 덱 목록 (최근 고친 순)
  info                               덱 목차 · 지금 판 · 릴리즈 · 남은 핀 수
  log [-n 20]                        판 이력 (v<n> = 커밋 수)
  commit -m \"<메시지>\" [--force]      바뀐 파일을 한 판으로 남긴다
  restore <v3 | 3 | 커밋> [--force]    그 판의 파일로 되돌려 새 판으로 남긴다 (이력은 지우지 않는다)
  pack <out.cppt>                    폴더째 한 파일로 묶는다 (판 이력 포함)
  unpack <file.cppt> [--to <폴더>]   묶음을 저장 폴더에 푼다
  add [--at <n>] [--title <제목>] [--copy <k>]
                                     쪽을 더한다 — 빈 쪽(또는 k쪽 사본)을 n번째 자리에(기본 맨 끝). 새 파일 경로를 돌려준다
  remove <n>                         n쪽을 목차에서 뺀다 (파일은 남긴다 — 지난 판 보기가 읽는다)
  move <n> --to <m>                  n쪽을 m번째 자리로 옮긴다

앱에 넘김 (꺼져 있으면 띄운다)
  status [--wait] [--timeout 600]    앱이 켜져 있는지 · 열린 덱 · 앱 안 Claude 가 일하는 중인지 (이것은 앱을 띄우지 않는다)
                                     --wait 는 앱 안 Claude 가 끝날 때까지 기다린다
  launch                             앱만 띄운다
  open [--slide 3]                   덱을 앱 화면에 연다 · 그 쪽으로 간다
  new <제목> [--template <이름>] [--no-open]
                                     저장 폴더에 새 덱 (표지 한 장) · 템플릿의 스타일 규칙(style)을 돌려준다
  import <file.pptx> [--no-open]     PPTX 를 가져와 새 덱으로
  style                              이 덱이 따를 스타일 규칙 (템플릿 · 가져온 덱이면 원본 유지) · 그림 생성 방식
  pins [--slides 1,3] [--no-marks]   사용자가 앱에서 쪽에 꽂은 핀 의견 · 그어 놓은 표시 (표시는 쪽 그림 위에 그려 PNG 로)
  pins --done <1,3 | all>            다 고친 핀을 지운다 (번호는 pins 가 준 n)
  gen                                <img data-gen=\"…\"> 그림 자리를 설정의 그림 생성 방식으로 채운다
  export <out.pptx> [--exact]        PPTX 로 내보낸다. --exact 는 모양 그대로(그림 + 투명 글상자)
  shot [--slides 1,3-5] [--out <폴더>] [--scale 1]
                                     쪽을 브라우저가 그린 그대로 PNG 로 굽는다 (기본 .claudeppt/shots/<n>.png)
  inspect [--slides 1,3-5]           PPTX 로 나갈 때 무엇이 편집 가능한 도형 · 글상자가 되고 무엇이 그림으로 굳는지, 쪽 밖으로 넘친 것
  check                              PPTX 를 PowerPoint 로 그려 웹과 픽셀로 견준다 (PowerPoint 필요)
  release [--name <이름>] [--notes <메모>]
                                     릴리즈 r<k> — releases/r<k>-v<n>.pptx 와 git 태그
";

/// 창 앱은 인자를 받지 않는다 — 인자가 하나라도 있으면 CLI 다. 틀린 명령 이름에 창이 뜨지 않고 도움말로 답하게
pub fn wants(args: &[String]) -> bool {
	!args.is_empty()
}

pub fn main(args: Vec<String>) -> i32 {
	let cmd = args[0].as_str();
	if matches!(cmd, "help" | "--help" | "-h") {
		print!("{HELP}");
		return 0;
	}
	let a = Args::parse(&args[1..]);
	let r = run(cmd, &a);
	let deck = USED.lock().unwrap().clone();
	if let Some(d) = &deck {
		touch(d, cmd);
	}
	let (code, mut out) = match r {
		Ok(v) => (0, json!({ "ok": true, "data": v })),
		Err(e) => (1, json!({ "ok": false, "error": e })),
	};
	if let Some(d) = deck {
		out["deck"] = json!(d);
	}
	println!("{}", serde_json::to_string_pretty(&out).unwrap());
	code
}

fn run(cmd: &str, a: &Args) -> R<Value> {
	match cmd {
		"paths" => Ok(json!({
			"exe": std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
			"data": control::data_dir(),
			"library": library(),
			"control": control::control_file(),
		})),
		"skill" => skill(a),
		"list" => list(),
		"info" => info(&deck_dir(a)?),
		"log" => {
			let n = a.get("n").map(|s| s.parse().map_err(|_| "-n 은 숫자")).transpose()?.unwrap_or(20);
			Ok(json!(vcs::vcs_log(s(&deck_dir(a)?), Some(n))?))
		}
		"commit" => {
			let dir = deck_own(a)?;
			let msg = a.get("m").ok_or("-m \"<메시지>\" 가 필요하다")?;
			guard(&dir, a)?;
			let c = vcs::vcs_commit(s(&dir), msg.into(), None)?;
			refresh(&dir, "commit");
			Ok(match c { Some(c) => json!(c), None => json!({ "unchanged": true }) })
		}
		"restore" => restore(&deck_own(a)?, a),
		"pack" => {
			let dir = deck_dir(a)?;
			let out = abs(a.pos(0).ok_or("묶을 파일 경로(<out.cppt>)가 필요하다")?);
			project::pack_deck(s(&dir), s(&out))?;
			Ok(json!({ "out": out }))
		}
		"unpack" => {
			let file = abs(a.pos(0).ok_or("풀 파일(<file.cppt>)이 필요하다")?);
			let name = file.file_stem().map(|x| x.to_string_lossy().into_owned()).unwrap_or("deck".into());
			let dest = a.get("to").map(abs).unwrap_or_else(|| library().join(name));
			Ok(json!({ "dir": project::unpack_deck(s(&file), s(&dest))? }))
		}
		"add" => add(&deck_own(a)?, a),
		"remove" => remove(&deck_own(a)?, a),
		"move" => move_slide(&deck_own(a)?, a),
		"status" => status(a),
		"launch" => {
			app()?;
			Ok(json!({ "app": true }))
		}
		"open" => {
			let dir = deck_dir(a)?;
			let slide = a.get("slide").map(|x| x.parse::<u32>().map_err(|_| "--slide 는 숫자")).transpose()?;
			app()?.call("open", json!({ "dir": dir, "slide": slide }))
		}
		"new" => {
			let title = a.pos.join(" ");
			let r = app()?.call("new", json!({ "title": title, "template": a.get("template"), "open": !a.has("no-open") }))?;
			used(r["dir"].as_str().map(PathBuf::from));
			Ok(r)
		}
		"import" => {
			let file = abs(a.pos(0).ok_or("가져올 PPTX 경로가 필요하다")?);
			if !file.is_file() {
				return Err(format!("파일이 없다: {}", file.display()));
			}
			let r = app()?.call("import", json!({ "path": file, "open": !a.has("no-open") }))?;
			used(r["dir"].as_str().map(PathBuf::from));
			Ok(r)
		}
		"export" => {
			let dir = deck_dir(a)?;
			let out = abs(a.pos(0).ok_or("내보낼 경로(<out.pptx>)가 필요하다")?);
			app_on(&dir)?.call("export", json!({ "dir": dir, "out": out, "exact": a.has("exact") }))
		}
		"shot" => {
			let dir = deck_dir(a)?;
			let out = a.get("out").map(abs).unwrap_or_else(|| dir.join(".claudeppt").join("shots"));
			let scale = a.get("scale").map(|x| x.parse::<f64>().map_err(|_| "--scale 은 숫자")).transpose()?.unwrap_or(1.0);
			app_on(&dir)?.call("shot", json!({ "dir": dir, "slides": slides(a)?, "out": out, "scale": scale }))
		}
		"inspect" => {
			let dir = deck_dir(a)?;
			app_on(&dir)?.call("inspect", json!({ "dir": dir, "slides": slides(a)? }))
		}
		"check" => {
			let dir = deck_dir(a)?;
			app_on(&dir)?.call("check", json!({ "dir": dir }))
		}
		"release" => {
			let dir = deck_own(a)?;
			app_on(&dir)?.call("release", json!({ "dir": dir, "name": a.get("name").unwrap_or(""), "notes": a.get("notes").unwrap_or("") }))
		}
		"style" => {
			let dir = deck_dir(a)?;
			app()?.call("style", json!({ "dir": dir }))
		}
		"pins" => match a.get("done") {
			Some(done) => {
				let dir = deck_own(a)?;
				let nums = if done.trim().eq_ignore_ascii_case("all") { Value::Null } else { nums(done, "--done")? };
				app()?.call("unpin", json!({ "dir": dir, "nums": nums }))
			}
			None => {
				let dir = deck_dir(a)?;
				app()?.call("pins", json!({ "dir": dir, "slides": slides(a)?, "marks": !a.has("no-marks") }))
			}
		},
		"gen" => {
			let dir = deck_own(a)?;
			guard(&dir, a)?;
			app_on(&dir)?.call("gen", json!({ "dir": dir }))
		}
		_ => Err(format!("모르는 명령: {cmd} — 쓸 수 있는 명령: {} (help 로 자세히)", COMMANDS.join(" "))),
	}
}

// ── 인자 · 경로 ──

struct Args {
	pos: Vec<String>,
	opt: HashMap<String, String>,
}

/// 값을 받는 선택지. 나머지 --이름 은 켜고 끄기다
const VALUED: &[&str] = &["deck", "m", "message", "n", "out", "slides", "slide", "scale", "name", "notes", "to", "template", "at", "title", "copy", "done", "timeout"];

impl Args {
	fn parse(raw: &[String]) -> Args {
		let mut a = Args { pos: vec![], opt: HashMap::new() };
		let mut it = raw.iter();
		while let Some(x) = it.next() {
			let key = x.strip_prefix("--").or_else(|| x.strip_prefix('-').filter(|k| k.len() == 1));
			match key {
				Some(k) => {
					let (k, inline) = match k.split_once('=') {
						Some((k, v)) => (k, Some(v.to_string())),
						None => (k, None),
					};
					let k = if k == "message" { "m" } else { k };
					let v = if VALUED.contains(&k) { inline.or_else(|| it.next().cloned()).unwrap_or_default() } else { "1".into() };
					a.opt.insert(k.into(), v);
				}
				None => a.pos.push(x.clone()),
			}
		}
		a
	}
	fn get(&self, k: &str) -> Option<&str> {
		self.opt.get(k).map(String::as_str)
	}
	fn has(&self, k: &str) -> bool {
		self.opt.contains_key(k)
	}
	fn pos(&self, i: usize) -> Option<&str> {
		self.pos.get(i).map(String::as_str)
	}
	/// 쪽 번호 하나 — 위치 인자(Ok(i)) 또는 선택지(Err(이름))
	fn num(&self, at: Result<usize, &str>, what: &str) -> R<usize> {
		let raw = match at {
			Ok(i) => self.pos(i),
			Err(k) => self.get(k),
		};
		let raw = raw.ok_or(format!("{what} 가 필요하다"))?;
		raw.trim().parse::<usize>().ok().filter(|n| *n >= 1).ok_or(format!("{what} 는 1 이상의 숫자: {raw}"))
	}
}

/// Git Bash 가 넘기는 /d/workspace/… 를 D:\workspace\… 로
fn fix_path(p: &str) -> String {
	let b = p.as_bytes();
	if b.len() >= 2 && b[0] == b'/' && b[1].is_ascii_alphabetic() && (b.len() == 2 || b[2] == b'/') {
		return format!("{}:\\{}", (b[1] as char).to_ascii_uppercase(), p.get(3..).unwrap_or("").replace('/', "\\"));
	}
	p.to_string()
}

fn abs(p: &str) -> PathBuf {
	let p = PathBuf::from(fix_path(p));
	std::path::absolute(&p).unwrap_or(p)
}

fn s(p: &Path) -> String {
	p.to_string_lossy().into_owned()
}

/// 「1,3-5」 → [1,3,4,5]
fn nums(spec: &str, what: &str) -> R<Value> {
	let mut out = vec![];
	for part in spec.split(',').map(str::trim).filter(|x| !x.is_empty()) {
		let num = |x: &str| x.trim().parse::<u32>().map_err(|_| format!("{what} 를 읽지 못했다: {spec}"));
		match part.split_once('-') {
			Some((x, y)) => out.extend(num(x)?..=num(y)?),
			None => out.push(num(part)?),
		}
	}
	Ok(json!(out))
}

/// --slides. 없으면 null — 모든 쪽
fn slides(a: &Args) -> R<Value> {
	a.get("slides").map_or(Ok(Value::Null), |x| nums(x, "--slides"))
}

// ── 덱 찾기 ──

fn settings() -> Value {
	std::fs::read_to_string(control::data_dir().join("settings.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
}

fn library() -> PathBuf {
	match settings()["library"].as_str().filter(|x| !x.is_empty()) {
		Some(l) => PathBuf::from(l),
		None => dirs::document_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default()).join("ClaudePPT"),
	}
}

/// 이 실행에서 쓴 덱 — 출력 봉투의 "deck" 과 바깥 작업 알림(touch)에 쓴다
static USED: Mutex<Option<PathBuf>> = Mutex::new(None);

fn used(d: Option<PathBuf>) {
	if d.is_some() {
		*USED.lock().unwrap() = d;
	}
}

/// 덱을 어떻게 골랐는지 — 앱에 열린 덱으로 떨어진 것은 덱을 바꾸는 명령에 쓰지 않는다
#[derive(PartialEq)]
enum Via {
	Given,
	App,
}

fn pick(a: &Args) -> R<(PathBuf, Via)> {
	if let Some(d) = a.get("deck") {
		return Ok((named(d)?, Via::Given));
	}
	// 지금 폴더에서 위로 — slides/ 안에서 불러도 그 덱을 찾는다
	if let Ok(mut d) = std::env::current_dir() {
		loop {
			if d.join("deck.json").is_file() {
				return Ok((d, Via::Given));
			}
			if !d.pop() {
				break;
			}
		}
	}
	if let Some(c) = connect().filter(|c| c.enabled) {
		if let Some(d) = c.call("status", json!({}))?["dir"].as_str().filter(|x| !x.is_empty()) {
			return Ok((PathBuf::from(d), Via::App));
		}
	}
	Err("덱을 고르지 않았다 — --deck <폴더 | 제목> 을 주거나 덱 폴더 안에서 부른다 (list 로 찾는다)".into())
}

/// --deck 값 → 덱 폴더. 폴더 · deck.json → 저장 폴더 안 폴더 이름 → 덱 제목 순서
fn named(d: &str) -> R<PathBuf> {
	let p = abs(d);
	let p = if p.file_name().is_some_and(|f| f.eq_ignore_ascii_case("deck.json")) { p.parent().unwrap().to_path_buf() } else { p };
	if p.join("deck.json").is_file() {
		return Ok(p);
	}
	let lib = library();
	if lib.join(d).join("deck.json").is_file() {
		return Ok(lib.join(d));
	}
	// 제목 — 폴더 이름은 제목을 다듬은 것이라(금지 글자 · 겹치는 이름에 붙는 번호) 사람이 부르는 이름과 어긋나기 쉽다
	let hits: Vec<String> = json!(project::library_list(s(&lib))?)
		.as_array()
		.into_iter()
		.flatten()
		.filter(|x| x["deck"]["title"].as_str().is_some_and(|t| t.trim().eq_ignore_ascii_case(d.trim())))
		.filter_map(|x| x["dir"].as_str().map(String::from))
		.collect();
	match hits.len() {
		1 => Ok(PathBuf::from(&hits[0])),
		0 => Err(format!("덱을 찾지 못했다: {d} (폴더 · deck.json · 저장 폴더 안 이름 · 제목 — list 로 찾는다)")),
		_ => Err(format!("제목이 같은 덱이 {}개다 — 폴더로 준다: {}", hits.len(), hits.join(" · "))),
	}
}

/// 읽기만 하는 명령의 덱 — 앱에 열린 덱으로 떨어져도 된다 (출력의 "deck" 으로 어느 덱인지 보인다)
fn deck_dir(a: &Args) -> R<PathBuf> {
	let (d, _) = pick(a)?;
	used(Some(d.clone()));
	Ok(d)
}

/// 덱을 바꾸는 명령의 덱. 앱에 열린 덱으로 떨어지면 거절한다.
/// Claude Code 의 Bash 는 작업 폴더 밖으로 간 cd 를 다음 호출에서 되돌린다 — 「덱 폴더에 cd 해 두었다」고 믿은 에이전트가
/// 사용자가 앱에 띄워 둔 다른 덱에 판을 남기던 길을 막는다
fn deck_own(a: &Args) -> R<PathBuf> {
	let (d, via) = pick(a)?;
	if via == Via::App {
		return Err(format!("덱을 바꾸는 명령은 --deck 으로 덱을 정한다 — 앱에 열린 덱으로 넘겨짚지 않는다 (지금 앱에 열린 덱: {})", d.display()));
	}
	used(Some(d.clone()));
	Ok(d)
}

// ── 앱 없이 하는 일 ──

fn list() -> R<Value> {
	let lib = library();
	let items = json!(project::library_list(s(&lib))?);
	let decks: Vec<Value> = items
		.as_array()
		.unwrap()
		.iter()
		.map(|x| json!({ "dir": x["dir"], "title": x["deck"]["title"], "slides": x["deck"]["slides"].as_array().map_or(0, |v| v.len()), "modified": x["modified"] }))
		.collect();
	Ok(json!({ "library": lib, "decks": decks }))
}

/// 스킬 본문은 CLI 와 판을 맞추려고 실행 파일에 담는다 — 앱을 새 판으로 올리면 skill 을 다시 부르면 된다
const SKILL_MD: &str = include_str!("../../skill/SKILL.md");

const WRAPPER: &str = r#"#!/usr/bin/env bash
# ClaudePPT CLI 꾸러미 — claudeppt.exe skill 이 썼다. 실행 파일을 찾아 인자를 그대로 넘긴다.
# 찾는 차례: $CLAUDEPPT_EXE → 이 꾸러미를 쓴 실행 파일 → 설치 자리(%LOCALAPPDATA%\ClaudePPT)
for c in "$CLAUDEPPT_EXE" "{exe}" "$LOCALAPPDATA/ClaudePPT/claudeppt.exe"; do
	[ -n "$c" ] && [ -f "$c" ] && exec "$c" "$@"
done
echo '{"ok":false,"error":"ClaudePPT 실행 파일을 찾지 못했다 — 앱을 설치하거나 CLAUDEPPT_EXE 를 준다"}'
exit 1
"#;

fn skill(a: &Args) -> R<Value> {
	install_skill(a.get("to").map(abs))?;
	Ok(skill_state(a.get("to").map(abs)))
}

/// 사용자 스킬 자리 — Claude Code 가 어느 폴더에서 열든 읽는다
pub fn skill_dir() -> PathBuf {
	dirs::home_dir().unwrap_or_default().join(".claude").join("skills").join("claudeppt")
}

fn exe_slash() -> String {
	std::env::current_exe().map(|p| s(&p).replace('\\', "/")).unwrap_or_default()
}

/// Claude Code 의 Bash(Git Bash)가 부르는 꾸러미. 이 실행 파일을 먼저 찾고, 옮겨졌으면 설치 자리를 본다
fn wrapper() -> String {
	WRAPPER.replace("{exe}", &exe_slash())
}

/// SKILL.md 와 cppt 꾸러미를 쓴다. 설정 화면 「바깥 연결 › 스킬」과 CLI skill 이 같이 쓴다
pub fn install_skill(to: Option<PathBuf>) -> R<()> {
	let to = to.unwrap_or_else(skill_dir);
	std::fs::create_dir_all(&to).map_err(|e| e.to_string())?;
	std::fs::write(to.join("SKILL.md"), SKILL_MD).map_err(|e| e.to_string())?;
	std::fs::write(to.join("cppt"), wrapper()).map_err(|e| e.to_string())
}

/// 깔린 스킬이 이 실행 파일과 맞는지 — current 가 false 면 앱을 새 판으로 올렸거나 실행 파일이 옮겨진 것이다
pub fn skill_state(to: Option<PathBuf>) -> Value {
	let to = to.unwrap_or_else(skill_dir);
	let md = std::fs::read_to_string(to.join("SKILL.md")).ok();
	let wr = std::fs::read_to_string(to.join("cppt")).ok();
	// 꾸러미에 적힌 실행 파일 — 다른 판의 앱이 깔았으면 그 경로가 보인다
	let linked = wr.as_deref().and_then(|w| w.lines().find(|l| l.starts_with("for c in")).and_then(|l| l.split('"').nth(3)).map(String::from));
	json!({
		"dir": to,
		"installed": md.is_some() && wr.is_some(),
		"current": md.as_deref() == Some(SKILL_MD) && wr.as_deref() == Some(wrapper().as_str()),
		"exe": exe_slash(),
		"linked": linked,
	})
}

fn read_deck(dir: &Path) -> R<Value> {
	serde_json::from_str(&std::fs::read_to_string(dir.join("deck.json")).map_err(|e| e.to_string())?).map_err(|e| format!("deck.json 을 읽지 못했다: {e}"))
}

fn info(dir: &Path) -> R<Value> {
	let deck = read_deck(dir)?;
	let slides: Vec<Value> = deck["slides"]
		.as_array()
		.map(|v| v.iter().enumerate().map(|(i, x)| json!({ "no": i + 1, "id": x["id"], "file": x["file"], "title": x["title"] })).collect())
		.unwrap_or_default();
	let head = vcs::vcs_log(s(dir), Some(1)).ok().and_then(|v| v.into_iter().next());
	let releases = std::fs::read_to_string(dir.join("releases").join("releases.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).unwrap_or(json!([]));
	// 남은 핀 — 사용자가 앱에서 쪽에 꽂아 둔 의견. 있으면 pins 로 읽는다
	let pins = std::fs::read_to_string(dir.join(".claudeppt").join("pins.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v.as_array().map(Vec::len)).unwrap_or(0);
	Ok(json!({
		"dir": dir,
		"title": deck["title"],
		"size": deck["size"],
		"theme": deck["theme"],
		"source": deck["source"],
		"slides": slides,
		"version": head,
		"releases": releases,
		"pins": pins,
	}))
}

fn restore(dir: &Path, a: &Args) -> R<Value> {
	let want = a.pos(0).ok_or("되돌릴 판(v3 · 3 · 커밋)이 필요하다")?;
	guard(dir, a)?;
	let log = vcs::vcs_log(s(dir), None)?;
	let log = json!(log);
	let n = want.trim_start_matches(['v', 'V']).parse::<u64>().ok();
	let hit = log.as_array().unwrap().iter().find(|c| match n {
		Some(n) => c["n"].as_u64() == Some(n),
		None => c["hash"].as_str().is_some_and(|h| h.starts_with(want)),
	});
	let c = hit.ok_or(format!("판을 찾지 못했다: {want}"))?;
	let r = vcs::vcs_restore(s(dir), c["hash"].as_str().unwrap().into(), format!("v{} 판으로 되돌림", c["n"]), None)?;
	refresh(dir, "restore");
	Ok(json!(r))
}

// ── 쪽 손보기 — 앱의 쪽 목록 · 우클릭 메뉴(store.ts addSlide · duplicateSlide · moveSlide · removeSlide)와 같은 일 ──
// deck.json 만 고친다. 앱이 이 덱을 열어 두었으면 폴더 감시가 목차를 다시 읽는다.

fn slide_list(deck: &mut Value) -> R<&mut Vec<Value>> {
	deck["slides"].as_array_mut().ok_or("deck.json 에 slides 배열이 없다".into())
}

/// deck.ts writeDeck(JSON.stringify(deck, null, 2))과 같은 꼴로 쓴다.
/// 키 순서를 지켜야(serde_json preserve_order) 판 비교에 키 순서만 바뀐 군더더기 줄이 생기지 않는다
fn write_deck(dir: &Path, deck: &mut Value) -> R<()> {
	deck["updated"] = json!(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
	let text = serde_json::to_string_pretty(deck).map_err(|e| e.to_string())? + "\n";
	std::fs::write(dir.join("deck.json"), text).map_err(|e| e.to_string())
}

/// 쪽 id — deck.ts newId 와 같은 꼴(「s」 + 영소문자 · 숫자 6자). 파일 이름이 되므로 이미 있는 파일과 겹치지 않게 고른다
fn new_id(dir: &Path) -> String {
	const A: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
	loop {
		let u = uuid::Uuid::new_v4();
		let id: String = std::iter::once('s').chain(u.as_bytes()[..6].iter().map(|b| A[*b as usize % A.len()] as char)).collect();
		if !dir.join("slides").join(format!("{id}.html")).exists() {
			return id;
		}
	}
}

fn add(dir: &Path, a: &Args) -> R<Value> {
	guard(dir, a)?;
	let mut deck = read_deck(dir)?;
	let n = slide_list(&mut deck)?.len();
	let at = if a.has("at") { a.num(Err("at"), "--at")?.min(n + 1) } else { n + 1 };
	let id = new_id(dir);
	let file = format!("slides/{id}.html");
	let mut entry = json!({ "id": id, "file": file });
	let html = if a.has("copy") {
		let k = a.num(Err("copy"), "--copy")?;
		let src = slide_list(&mut deck)?.get(k - 1).cloned().ok_or(format!("없는 쪽: {k} (이 덱은 {n}쪽)"))?;
		if let Some(t) = src.get("title") {
			entry["title"] = t.clone();
		}
		// 같은 slides/ 폴더에 두므로 그림 · CSS 의 상대 경로가 그대로 맞는다
		std::fs::read_to_string(dir.join(src["file"].as_str().unwrap_or_default())).map_err(|e| format!("{k}쪽 파일을 읽지 못했다: {e}"))?
	} else {
		// deck.ts slideHtml 과 같은 뼈대 — 빈 <section class="slide"> 하나
		let lang = settings()["lang"].as_str().unwrap_or("ko").to_string();
		format!("<!doctype html>\n<html lang=\"{lang}\">\n<head>\n<meta charset=\"utf-8\">\n<link rel=\"stylesheet\" href=\"../theme.css\">\n</head>\n<body>\n<section class=\"slide\">\n</section>\n</body>\n</html>\n")
	};
	if let Some(t) = a.get("title") {
		entry["title"] = json!(t);
	}
	std::fs::create_dir_all(dir.join("slides")).map_err(|e| e.to_string())?;
	std::fs::write(dir.join(&file), html).map_err(|e| e.to_string())?;
	slide_list(&mut deck)?.insert(at - 1, entry.clone());
	write_deck(dir, &mut deck)?;
	Ok(json!({ "no": at, "id": id, "file": file, "path": dir.join("slides").join(format!("{id}.html")), "title": entry["title"], "slides": n + 1 }))
}

fn remove(dir: &Path, a: &Args) -> R<Value> {
	guard(dir, a)?;
	let k = a.num(Ok(0), "뺄 쪽 번호")?;
	let mut deck = read_deck(dir)?;
	let list = slide_list(&mut deck)?;
	let n = list.len();
	if k > n {
		return Err(format!("없는 쪽: {k} (이 덱은 {n}쪽)"));
	}
	if n < 2 {
		return Err("마지막 한 쪽은 뺄 수 없다".into());
	}
	let gone = list.remove(k - 1);
	write_deck(dir, &mut deck)?;
	Ok(json!({ "removed": { "no": k, "id": gone["id"], "file": gone["file"], "title": gone["title"] }, "slides": n - 1 }))
}

fn move_slide(dir: &Path, a: &Args) -> R<Value> {
	guard(dir, a)?;
	let from = a.num(Ok(0), "옮길 쪽 번호")?;
	let to = a.num(Err("to"), "--to")?;
	let mut deck = read_deck(dir)?;
	let list = slide_list(&mut deck)?;
	let n = list.len();
	if from > n || to > n {
		return Err(format!("없는 쪽: {} (이 덱은 {n}쪽)", from.max(to)));
	}
	let x = list.remove(from - 1);
	list.insert(to - 1, x.clone());
	write_deck(dir, &mut deck)?;
	Ok(json!({ "moved": { "from": from, "to": to, "id": x["id"], "title": x["title"] } }))
}

/// 앱 안 Claude 가 이 덱을 고치는 중이면 덱을 바꾸지 않는다 — 반쯤 고친 파일이 판에 들어가거나 덮이고, 그 턴의 판에 바깥 변경이 섞인다
fn guard(dir: &Path, a: &Args) -> R<()> {
	if a.has("force") {
		return Ok(());
	}
	let Some(c) = connect().filter(|c| c.enabled) else { return Ok(()) };
	let st = c.call("status", json!({}))?;
	if st["running"].as_bool() == Some(true) && st["dir"].as_str().is_some_and(|d| same(Path::new(d), dir)) {
		return Err("앱 안 Claude 가 이 덱을 고치는 중이다 — status --wait 로 기다린 뒤 다시 하거나 --force".into());
	}
	Ok(())
}

fn same(a: &Path, b: &Path) -> bool {
	s(a).trim_end_matches('\\').eq_ignore_ascii_case(s(b).trim_end_matches('\\'))
}

/// 앱이 이 덱을 열어 두었으면 판 목록 · 릴리즈를 다시 읽게 한다. 파일 변경은 폴더 감시가 잡지만 .git 은 보지 않는다
fn refresh(dir: &Path, why: &str) {
	if let Some(c) = connect().filter(|c| c.enabled) {
		let _ = c.call("refresh", json!({ "dir": dir, "why": why }));
	}
}

/// 바깥에서 이 덱을 다루고 있다고 켜진 앱에 알린다 (앱을 띄우지는 않는다). 앱은 몇 분 동안 그 덱에서 앱 안 Claude 에게 보내기 전에 한 번 묻는다 —
/// 바깥 Claude 가 고치는 파일과 앱 안 Claude 의 턴이 한 판에 섞이지 않게
fn touch(dir: &Path, cmd: &str) {
	if let Some(c) = connect().filter(|c| c.enabled) {
		let _ = c.call("touch", json!({ "dir": dir, "cmd": cmd }));
	}
}

/// status — 앱을 띄우지 않는다. --wait 면 앱 안 Claude 가 끝날 때까지(기본 600초) 기다린다
fn status(a: &Args) -> R<Value> {
	let timeout = a.get("timeout").map(|x| x.parse::<u64>().map_err(|_| "--timeout 은 초")).transpose()?.unwrap_or(600);
	let t0 = Instant::now();
	loop {
		let st = match connect() {
			Some(c) if !c.enabled => return Ok(json!({ "app": true, "enabled": false, "error": OFF })),
			Some(c) => c.call("status", json!({}))?,
			None => return Ok(json!({ "app": false })),
		};
		if !a.has("wait") || st["running"].as_bool() != Some(true) {
			return Ok(st);
		}
		if t0.elapsed() >= Duration::from_secs(timeout) {
			return Err(format!("{timeout}초를 기다렸지만 앱 안 Claude 가 아직 일한다 — 사용자에게 알리고 다시 기다린다"));
		}
		std::thread::sleep(Duration::from_secs(2));
	}
}

// ── 앱 부르기 ──

const OFF: &str = "앱의 「설정 › Claude Code 연결 › 명령 받기」가 꺼져 있다 — 사용자에게 켜 달라고 한다";

struct Conn {
	port: u16,
	token: String,
	// 설정 「Claude Code 연결 › 명령 받기」가 켜져 있는지. 꺼져 있어도 ping 에는 답한다 — 그래야 CLI 가 앱을 하나 더 띄우지 않는다
	enabled: bool,
}

impl Conn {
	fn raw(&self, cmd: &str, args: Value) -> R<Value> {
		let addr = std::net::SocketAddr::from(([127, 0, 0, 1], self.port));
		let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(2)).map_err(|e| format!("앱에 붙지 못했다: {e}"))?;
		s.write_all(format!("{}\n", json!({ "token": self.token, "cmd": cmd, "args": args })).as_bytes()).map_err(|e| e.to_string())?;
		let mut line = String::new();
		BufReader::new(s).read_line(&mut line).map_err(|e| e.to_string())?;
		serde_json::from_str(&line).map_err(|_| "앱의 답을 읽지 못했다".to_string())
	}
	fn call(&self, cmd: &str, args: Value) -> R<Value> {
		let r = self.raw(cmd, args)?;
		if r["ok"].as_bool() == Some(true) { Ok(r["data"].clone()) } else { Err(r["error"].as_str().unwrap_or("앱이 실패를 알렸다").into()) }
	}
}

/// 켜져 있고 답하는 앱. control.json 이 남아 있어도 앱이 죽었으면 None
fn connect() -> Option<Conn> {
	let v: Value = serde_json::from_str(&std::fs::read_to_string(control::control_file()).ok()?).ok()?;
	let mut c = Conn { port: v["port"].as_u64()? as u16, token: v["token"].as_str()?.into(), enabled: true };
	let r = c.raw("ping", json!({})).ok().filter(|r| r["ok"].as_bool() == Some(true))?;
	c.enabled = r["data"]["enabled"].as_bool() != Some(false);
	Some(c)
}

fn app() -> R<Conn> {
	launch().map(|(c, _)| c)
}

/// 덱 하나를 다루려고 앱에 붙는다. 꺼져 있던 앱을 띄웠으면 그 덱을 화면에 연다 —
/// 띄우기만 하면 홈 화면이 떠 있어 사용자는 바깥에서 무엇을 하는지 알 수 없다
fn app_on(dir: &Path) -> R<Conn> {
	let (c, fresh) = launch()?;
	if fresh {
		let _ = c.call("open", json!({ "dir": dir }));
	}
	Ok(c)
}

/// 앱에 붙는다. 꺼져 있으면 이 실행 파일을 인자 없이 띄우고, 화면이 준비될 때까지(최대 90초) 기다린다. 둘째 값은 새로 띄웠는지
fn launch() -> R<(Conn, bool)> {
	if let Some(c) = connect() {
		if !c.enabled {
			return Err(OFF.into());
		}
		return Ok((c, false));
	}
	let exe = std::env::current_exe().map_err(|e| e.to_string())?;
	let mut cmd = std::process::Command::new(&exe);
	cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		// DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP — CLI 가 끝나도 앱은 남는다
		cmd.creation_flags(0x0000_0008 | 0x0000_0200);
		no_inherit_stdio();
	}
	cmd.spawn().map_err(|e| format!("앱을 띄우지 못했다: {e}"))?;
	let t0 = Instant::now();
	while t0.elapsed() < Duration::from_secs(90) {
		std::thread::sleep(Duration::from_millis(400));
		if let Some(c) = connect() {
			// 설정에서 명령 받기를 꺼 둔 앱이면 막 띄운 앱도 받지 않는다 — 그대로 부르면 「꺼져 있다」 대신 알 수 없는 실패가 난다
			if !c.enabled {
				return Err(OFF.into());
			}
			return Ok((c, true));
		}
	}
	Err(format!("앱을 띄웠지만 90초 안에 준비되지 않았다 ({})", exe.display()))
}

/// 이 프로세스의 표준 입출력 핸들을 앱에 물려주지 않게 한다.
/// 물려주면 셸(Claude Code 의 Bash)이 그 파이프가 닫히기를 — 곧 앱이 꺼지기를 — 기다리며 멈춘다.
#[cfg(windows)]
fn no_inherit_stdio() {
	unsafe extern "system" {
		fn GetStdHandle(n: u32) -> isize;
		fn SetHandleInformation(h: isize, mask: u32, flags: u32) -> i32;
	}
	for n in [-10i32, -11, -12] {
		unsafe {
			let h = GetStdHandle(n as u32);
			if h != 0 && h != -1 {
				SetHandleInformation(h, 1, 0);
			}
		}
	}
}
