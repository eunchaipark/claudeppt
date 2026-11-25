// 판 관리 — 프로젝트 폴더마다 git 저장소를 둔다. 사용자는 git 을 몰라도 된다.
//
//   판(v<n>)      커밋 수. Claude 한 턴 · 직접 편집 한 묶음 · 되돌리기가 각각 한 판이 된다.
//   릴리즈(r<k>)  사용자가 「릴리즈」로 확정한 판. git 태그 r<k> 와 releases/r<k>-v<n>.pptx 가 남는다.
//   되돌리기      지난 판의 파일을 지금 위에 덮어 새 판으로 남긴다. 이력은 지우지 않는다 (앞으로만 간다).
//
// 사용자의 git 설정(이름 · 줄끝 변환)에 기대지 않도록 매번 -c 로 준다.
//
// 앱 명령은 #[tauri::command(async)] — 화면(메인) 스레드가 아니라 스레드 풀에서 돈다.
// git 을 여러 번 띄우고 다른 판 남기기를 최대 60초 기다리므로(lock), 화면 스레드에서 돌면 그동안 창 전체가 멈춘다.
// CLI(cli.rs)는 같은 함수를 그대로 동기로 부른다.

use crate::{Res, err, hidden};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

fn git(dir: &Path) -> Command {
	let mut c = Command::new("git");
	hidden(&mut c);
	c.current_dir(dir).args([
		"-c", "core.autocrlf=false",
		"-c", "core.quotepath=false",
		"-c", "user.name=ClaudePPT",
		"-c", "user.email=claudeppt@local",
		"-c", "commit.gpgsign=false",
		"-c", "tag.gpgsign=false",
		// 사용자 전역 설정이 덱 저장소에 끼어들지 않게.
		// 훅(전역 core.hooksPath · init 템플릿)이 판 남기기를 막거나 늦추고, fsmonitor 는 덱마다 상주 프로세스를 남기고,
		// log.showSignature · color.ui 는 git log 출력에 줄을 끼워 판 목록 읽기를 깬다
		"-c", "core.hooksPath=.git/claudeppt-no-hooks",
		"-c", "core.fsmonitor=false",
		"-c", "log.showSignature=false",
		"-c", "color.ui=false",
		"-c", "i18n.logOutputEncoding=utf-8",
	]);
	c
}

fn run(dir: &Path, args: &[&str]) -> Res<String> {
	let o = git(dir).args(args).output().map_err(|e| format!("git 을 띄우지 못했다 ({e}) — git 이 설치되어 있어야 판 관리가 된다"))?;
	if !o.status.success() {
		return Err(String::from_utf8_lossy(&o.stderr).trim().to_string());
	}
	Ok(String::from_utf8_lossy(&o.stdout).trim_end().to_string())
}

pub fn show_file(dir: &Path, rev: &str, rel: &str) -> Option<Vec<u8>> {
	if !rev.chars().all(|c| c.is_ascii_hexdigit()) {
		return None;
	}
	let o = git(dir).args(["show", &format!("{rev}:{rel}")]).output().ok()?;
	o.status.success().then_some(o.stdout)
}

const IGNORE: &str = "# 앱이 쓰는 상태(핀 · 대화 · 임시 파일) — 판에 넣지 않는다
.claudeppt/
";

#[tauri::command(async)]
pub fn vcs_init(dir: String) -> Res<()> {
	let d = Path::new(&dir);
	std::fs::create_dir_all(d).map_err(err)?;
	if !d.join(".git").exists() {
		run(d, &["init", "-q", "-b", "main"])?;
	}
	if !d.join(".gitignore").exists() {
		std::fs::write(d.join(".gitignore"), IGNORE).map_err(err)?;
	}
	Ok(())
}

#[derive(Serialize)]
pub struct Commit {
	n: u32,
	hash: String,
	short: String,
	date: String,
	subject: String,
	tags: Vec<String>,
	/// 남긴 이 — 팀원이 시킨 판은 그 사람 이름, 그 밖(직접 편집 · 바깥 CLI)은 ClaudePPT
	author: String,
}

/// 바뀐 것이 있으면 한 판으로 남기고 그 판을 돌려준다. 없으면 None.
/// author — 이 판을 시킨 팀원 이름. 주면 git 작성자로 남는다 (판을 남기는 이는 그대로 ClaudePPT)
#[tauri::command(async)]
pub fn vcs_commit(dir: String, message: String, author: Option<String>) -> Res<Option<Commit>> {
	vcs_init(dir.clone())?;
	let _l = lock(Path::new(&dir))?;
	commit_all(Path::new(&dir), &message, author.as_deref())
}

/// 판 남기기 잠금 — 앱과 앱 밖 CLI(Claude Code 세션마다 프로세스가 따로 돈다)가 덱 하나의 git 색인을 함께 쓴다.
/// 잠그지 않으면 같은 때 판을 남길 때 한쪽이 git 의 index.lock 에 걸려 실패하고, 되돌리기(남기기 → 덮기 → 남기기) 사이에 다른 판이 끼어든다
struct Lock(PathBuf);

impl Drop for Lock {
	fn drop(&mut self) {
		let _ = std::fs::remove_file(&self.0);
	}
}

fn lock(d: &Path) -> Res<Lock> {
	let p = d.join(".git").join("claudeppt-commit.lock");
	let t0 = Instant::now();
	loop {
		match std::fs::OpenOptions::new().write(true).create_new(true).open(&p) {
			Ok(_) => return Ok(Lock(p)),
			Err(_) => {
				// 죽은 프로세스가 남긴 잠금 — 판 하나 남기기는 몇 초면 끝나므로 2분 넘게 묵었으면 걷는다
				let stale = p.metadata().and_then(|m| m.modified()).ok().and_then(|m| m.elapsed().ok()).is_some_and(|e| e > Duration::from_secs(120));
				if stale {
					let _ = std::fs::remove_file(&p);
					continue;
				}
				if t0.elapsed() > Duration::from_secs(60) {
					return Err("다른 판 남기기가 60초 넘게 끝나지 않는다 — 잠시 뒤 다시 한다".into());
				}
				std::thread::sleep(Duration::from_millis(50));
			}
		}
	}
}

/// 이 파일들만 한 판으로 — 여러 세션의 Claude 턴이 함께 돌 때, 끝난 턴의 판에 아직 도는 다른 턴이 고치던 파일이 섞이지 않게.
/// 경로는 덱 폴더 기준 상대 경로만 받는다 (절대 경로 · .. 은 건너뛴다). 남은 파일은 다음 판에 들어간다
#[tauri::command(async)]
pub fn vcs_commit_paths(dir: String, message: String, author: Option<String>, paths: Vec<String>) -> Res<Option<Commit>> {
	vcs_init(dir.clone())?;
	let d = Path::new(&dir);
	let _l = lock(d)?;
	if run(d, &["rev-parse", "--verify", "-q", "HEAD"]).is_err() {
		// 첫 판은 통째로
		return commit_all(d, &message, author.as_deref());
	}
	// 색인만 비운다 — 작업 파일은 그대로
	run(d, &["reset", "-q"])?;
	for p in paths.iter().map(|p| p.replace('\\', "/")).filter(|p| safe_rel(p)) {
		// :(literal) — 경로의 * ? [ 를 무늬로 읽지 않게. 지운 파일도 -A 로 담긴다
		let spec = format!(":(literal){p}");
		let _ = run(d, &["add", "-A", "--", &spec]);
	}
	finish(d, &message, author.as_deref())
}

/// 덱 폴더 안 상대 경로인가
fn safe_rel(p: &str) -> bool {
	!p.is_empty() && !p.starts_with('/') && !p.contains(':') && !p.split('/').any(|c| c == "..")
}

fn commit_all(d: &Path, message: &str, author: Option<&str>) -> Res<Option<Commit>> {
	run(d, &["add", "-A"])?;
	finish(d, message, author)
}

/// 색인에 담긴 것을 한 판으로 (바뀐 것이 없으면 None, 첫 판은 비어 있어도 남긴다)
fn finish(d: &Path, message: &str, author: Option<&str>) -> Res<Option<Commit>> {
	let changed = !git(d).args(["diff", "--cached", "--quiet"]).status().map_err(err)?.success();
	let first = run(d, &["rev-parse", "--verify", "-q", "HEAD"]).is_err();
	if !changed && !first {
		return Ok(None);
	}
	// git 작성자 꼴은 「이름 <메일>」 — 이름에 꺾쇠가 있으면 꼴이 깨지므로 뺀다
	let by = author.map(|a| a.replace(['<', '>'], "").trim().to_string()).filter(|a| !a.is_empty()).map(|a| format!("--author={a} <member@claudeppt>"));
	let mut args = vec!["commit", "-q", "--allow-empty", "-m", message];
	if let Some(b) = &by {
		args.push(b);
	}
	run(d, &args)?;
	Ok(head(d).ok())
}

fn head(d: &Path) -> Res<Commit> {
	Ok(vcs_log(d.to_string_lossy().into(), Some(1))?.into_iter().next().ok_or("판이 없다")?)
}

#[tauri::command(async)]
pub fn vcs_log(dir: String, limit: Option<u32>) -> Res<Vec<Commit>> {
	let d = Path::new(&dir);
	if run(d, &["rev-parse", "--verify", "-q", "HEAD"]).is_err() {
		return Ok(vec![]);
	}
	let total: u32 = run(d, &["rev-list", "--count", "HEAD"])?.trim().parse().unwrap_or(0);
	let mut tags: std::collections::HashMap<String, Vec<String>> = Default::default();
	if let Ok(t) = run(d, &["show-ref", "--tags"]) {
		for line in t.lines() {
			if let Some((h, r)) = line.split_once(' ') {
				tags.entry(h.to_string()).or_default().push(r.trim_start_matches("refs/tags/").to_string());
			}
		}
	}
	let mut args = vec!["log".to_string(), "--format=%H%x09%h%x09%ci%x09%an%x09%s".to_string()];
	if let Some(l) = limit {
		args.push(format!("-{l}"));
	}
	let args: Vec<&str> = args.iter().map(String::as_str).collect();
	let out = run(d, &args)?;
	Ok(out
		.lines()
		.enumerate()
		.filter_map(|(i, l)| {
			let mut p = l.splitn(5, '\t');
			let hash = p.next()?.to_string();
			Some(Commit {
				n: total - i as u32,
				short: p.next()?.to_string(),
				date: p.next()?.get(..16)?.to_string(),
				author: p.next()?.to_string(),
				subject: p.next().unwrap_or("").to_string(),
				tags: tags.remove(&hash).unwrap_or_default(),
				hash,
			})
		})
		.collect())
}

#[tauri::command(async)]
pub fn vcs_tag(dir: String, name: String) -> Res<()> {
	run(Path::new(&dir), &["tag", &name]).map(|_| ())
}

/// 지난 판으로 되돌린다 — 지금 남지 않은 변경을 먼저 한 판으로 남기고, 그 판 뒤에 생긴 파일은 지운 뒤
/// 그 판의 파일을 덮어 새 판으로 남긴다.
/// releases/ · source/ 는 덱 내용이 아니라 기록이다 — 되돌려도 지우거나 옛것으로 바꾸지 않는다.
/// (지우면 릴리즈 PPTX · 원본 쪽 그림이 사라지고, 다음 릴리즈가 같은 r<k> 를 다시 단다)
#[tauri::command(async)]
pub fn vcs_restore(dir: String, hash: String, message: String, author: Option<String>) -> Res<Option<Commit>> {
	let d = Path::new(&dir);
	vcs_init(dir.clone())?;
	let _l = lock(d)?;
	commit_all(d, "되돌리기 전 변경을 남긴다", None)?;
	let keep = |p: &str| p.starts_with("releases/") || p.starts_with("source/");
	let added = run(d, &["diff", "--name-only", "--diff-filter=A", &hash, "HEAD"])?;
	for rel in added.lines().filter(|l| !l.is_empty() && !keep(l)) {
		let _ = std::fs::remove_file(d.join(rel));
	}
	run(d, &["checkout", &hash, "--", ".", ":(exclude)releases", ":(exclude)source"])?;
	commit_all(d, &message, author.as_deref())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn tmp(name: &str) -> String {
		let d = std::env::temp_dir().join(format!("cppt-vcs-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&d);
		std::fs::create_dir_all(&d).unwrap();
		d.to_string_lossy().into()
	}

	#[test]
	fn author_is_kept_on_each_version() {
		let dir = tmp("author");
		let p = Path::new(&dir);
		std::fs::write(p.join("a.txt"), "1").unwrap();
		let c = vcs_commit(dir.clone(), "first".into(), Some("민수".into())).unwrap().unwrap();
		assert_eq!(c.author, "민수");
		assert_eq!(c.n, 1);
		// 바뀐 것이 없으면 판을 남기지 않는다
		assert!(vcs_commit(dir.clone(), "same".into(), Some("민수".into())).unwrap().is_none());
		// 이름이 없으면 ClaudePPT · 꺾쇠는 빼고 · 빈 이름은 없는 것으로
		std::fs::write(p.join("a.txt"), "2").unwrap();
		assert_eq!(vcs_commit(dir.clone(), "no name".into(), None).unwrap().unwrap().author, "ClaudePPT");
		std::fs::write(p.join("a.txt"), "3").unwrap();
		assert_eq!(vcs_commit(dir.clone(), "brackets".into(), Some("<은지>".into())).unwrap().unwrap().author, "은지");
		std::fs::write(p.join("a.txt"), "4").unwrap();
		assert_eq!(vcs_commit(dir.clone(), "blank".into(), Some("  ".into())).unwrap().unwrap().author, "ClaudePPT");
		// 제목에 탭이 있어도 작성자 · 제목이 섞이지 않는다
		std::fs::write(p.join("a.txt"), "5").unwrap();
		let t = vcs_commit(dir.clone(), "tab\there".into(), Some("지호".into())).unwrap().unwrap();
		assert_eq!((t.author.as_str(), t.subject.as_str()), ("지호", "tab\there"));
		let log = vcs_log(dir.clone(), None).unwrap();
		assert_eq!(log.iter().map(|c| c.author.as_str()).collect::<Vec<_>>(), ["지호", "ClaudePPT", "은지", "ClaudePPT", "민수"]);
		let _ = std::fs::remove_dir_all(p);
	}

	/// 여러 턴이 함께 돌 때 — 끝난 턴의 판에는 그 턴이 고친 파일만, 남은 것은 다음 판에
	#[test]
	fn commit_paths_takes_only_given_files() {
		let dir = tmp("paths");
		let p = Path::new(&dir);
		std::fs::create_dir_all(p.join("slides")).unwrap();
		std::fs::write(p.join("slides/a.html"), "a1").unwrap();
		std::fs::write(p.join("slides/b.html"), "b1").unwrap();
		vcs_commit(dir.clone(), "첫 판".into(), None).unwrap().unwrap();
		std::fs::write(p.join("slides/a.html"), "a2").unwrap();
		std::fs::write(p.join("slides/b.html"), "b2").unwrap();
		std::fs::write(p.join("slides/new [1].html"), "n").unwrap();
		let c = vcs_commit_paths(dir.clone(), "세션 1 턴".into(), Some("민수".into()), vec!["slides/a.html".into(), "slides/new [1].html".into(), "../outside.txt".into(), "C:/x".into()]).unwrap().unwrap();
		assert_eq!(c.author, "민수");
		let files = run(p, &["show", "--name-only", "--format=", "HEAD"]).unwrap();
		let mut files: Vec<&str> = files.lines().collect();
		files.sort();
		assert_eq!(files, ["slides/a.html", "slides/new [1].html"]);
		// b 는 아직 바뀐 채로 남아 있다가 다음 판에
		let c2 = vcs_commit(dir.clone(), "남은 것".into(), Some("은채".into())).unwrap().unwrap();
		assert_eq!(run(p, &["show", "--name-only", "--format=", "HEAD"]).unwrap().trim(), "slides/b.html");
		assert_eq!(c2.n, 3);
		// 담을 것이 없으면 판을 남기지 않는다
		assert!(vcs_commit_paths(dir.clone(), "없음".into(), None, vec!["slides/a.html".into()]).unwrap().is_none());
		let _ = std::fs::remove_dir_all(p);
	}

	#[test]
	fn restore_keeps_author() {
		let dir = tmp("restore");
		let p = Path::new(&dir);
		std::fs::write(p.join("a.txt"), "1").unwrap();
		let v1 = vcs_commit(dir.clone(), "v1".into(), Some("민수".into())).unwrap().unwrap();
		std::fs::write(p.join("a.txt"), "2").unwrap();
		std::fs::write(p.join("b.txt"), "new").unwrap();
		vcs_commit(dir.clone(), "v2".into(), Some("은지".into())).unwrap();
		let r = vcs_restore(dir.clone(), v1.hash.clone(), "back".into(), Some("지호".into())).unwrap().unwrap();
		assert_eq!(r.author, "지호");
		assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "1");
		assert!(!p.join("b.txt").exists());
		// 잠금 파일이 남지 않는다
		assert!(!p.join(".git").join("claudeppt-commit.lock").exists());
		let _ = std::fs::remove_dir_all(p);
	}

	/// 저장소 설정에 훅 · 서명 표시 · 색을 켜 두어도 (사용자 전역 설정과 같은 효과) 판 남기기 · 판 목록이 그대로 된다
	#[test]
	fn user_git_config_does_not_leak_in() {
		let dir = tmp("isolate");
		let p = Path::new(&dir);
		vcs_init(dir.clone()).unwrap();
		let hooks = p.join(".git").join("hooks");
		std::fs::create_dir_all(&hooks).unwrap();
		std::fs::write(hooks.join("pre-commit"), "#!/bin/sh\necho blocked >&2\nexit 1\n").unwrap();
		std::fs::write(hooks.join("commit-msg"), "#!/bin/sh\nexit 1\n").unwrap();
		for (k, v) in [("core.hooksPath", ".git/hooks"), ("log.showSignature", "true"), ("color.ui", "always"), ("core.fsmonitor", "true")] {
			let ok = Command::new("git").current_dir(p).args(["config", k, v]).status().unwrap().success();
			assert!(ok, "git config {k}");
		}
		std::fs::write(p.join("a.txt"), "1").unwrap();
		let c = vcs_commit(dir.clone(), "첫 판".into(), None).unwrap().expect("훅이 판 남기기를 막았다");
		assert_eq!((c.n, c.subject.as_str()), (1, "첫 판"));
		std::fs::write(p.join("a.txt"), "2").unwrap();
		vcs_commit(dir.clone(), "둘째 판".into(), None).unwrap().unwrap();
		vcs_tag(dir.clone(), "r1".into()).unwrap();
		let log = vcs_log(dir.clone(), None).unwrap();
		assert_eq!(log.iter().map(|c| (c.n, c.subject.as_str())).collect::<Vec<_>>(), [(2, "둘째 판"), (1, "첫 판")]);
		assert_eq!(log[0].tags, ["r1"]);
		assert_eq!(log[0].hash.len(), 40);
		let r = vcs_restore(dir.clone(), log[1].hash.clone(), "v1 로".into(), None).unwrap().unwrap();
		assert_eq!(r.n, 3);
		assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "1");
		let _ = std::fs::remove_dir_all(p);
	}
}
