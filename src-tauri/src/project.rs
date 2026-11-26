// 앱 설정 · 프로젝트 열고 닫기 · 저장 폴더(덱 폴더 모음) · 한 파일 묶음(.cppt) 내보내기와 풀기.
//
// 프로젝트 = deck.json 이 있는 폴더 하나. 파일 꼴은 화면 쪽 src/lib/deck.ts 머리말에 적었다.
// .cppt 는 그 폴더를 zip 으로 묶은 것 — 주고받거나 보관할 때 쓴다. 판 이력(.git)까지 함께 담긴다.

use crate::{AppState, Res, err, watch};
use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

#[derive(Serialize)]
pub struct Paths {
	data: String,
	library: String,
}

fn data_dir(app: &AppHandle) -> Res<PathBuf> {
	let d = app.path().app_data_dir().map_err(err)?;
	std::fs::create_dir_all(&d).map_err(err)?;
	Ok(d)
}

#[tauri::command]
pub fn app_paths(app: AppHandle) -> Res<Paths> {
	let lib = dirs::document_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default()).join("ClaudePPT");
	Ok(Paths { data: data_dir(&app)?.to_string_lossy().into(), library: lib.to_string_lossy().into() })
}

/// 설정은 화면 쪽이 모양을 정한다 — 여기서는 JSON 한 덩이로 읽고 쓰기만 한다.
#[tauri::command]
pub fn settings_load(app: AppHandle) -> Res<Value> {
	let p = data_dir(&app)?.join("settings.json");
	Ok(std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null))
}

#[tauri::command]
pub fn settings_save(app: AppHandle, value: Value) -> Res<()> {
	let p = data_dir(&app)?.join("settings.json");
	let tmp = p.with_extension("json.tmp");
	std::fs::write(&tmp, serde_json::to_string_pretty(&value).map_err(err)?).map_err(err)?;
	std::fs::rename(tmp, p).map_err(err)
}

/// 프로젝트를 deck:// 에 올리고 폴더 감시를 건다. 같은 폴더면 같은 id 를 돌려준다.
#[tauri::command]
pub fn project_open(app: AppHandle, state: State<AppState>, dir: String) -> Res<String> {
	let root = PathBuf::from(&dir);
	if !root.join("deck.json").exists() {
		return Err("deck.json 이 없는 폴더다".into());
	}
	let id = {
		let mut map = state.projects.lock().unwrap();
		if let Some((id, _)) = map.iter().find(|(_, p)| **p == root) {
			id.clone()
		} else {
			let id = uuid::Uuid::new_v4().simple().to_string()[..10].to_string();
			map.insert(id.clone(), root.clone());
			id
		}
	};
	let mut ws = state.watchers.lock().unwrap();
	if !ws.contains_key(&id) {
		ws.insert(id.clone(), watch::start(app, id.clone(), root)?);
	}
	Ok(id)
}

#[tauri::command]
pub fn project_close(state: State<AppState>, id: String) -> Res<()> {
	state.watchers.lock().unwrap().remove(&id);
	Ok(())
}

#[derive(Serialize)]
pub struct LibItem {
	dir: String,
	deck: Value,
	modified: i64,
}

/// 저장 폴더 바로 아래에서 deck.json 이 있는 폴더를 찾는다.
#[tauri::command(async)]
pub fn library_list(dir: String) -> Res<Vec<LibItem>> {
	let mut out = vec![];
	let Ok(rd) = std::fs::read_dir(&dir) else { return Ok(out) };
	for e in rd.flatten() {
		let p = e.path();
		let f = p.join("deck.json");
		let Ok(text) = std::fs::read_to_string(&f) else { continue };
		let deck = serde_json::from_str(&text).unwrap_or(Value::Null);
		let modified = std::fs::metadata(&f).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
		out.push(LibItem { dir: p.to_string_lossy().into(), deck, modified });
	}
	out.sort_by(|a, b| b.modified.cmp(&a.modified));
	Ok(out)
}

/// 프로젝트 폴더를 .cppt 한 파일로 묶는다. 앱이 쓰는 임시 상태(.claudeppt/run) 는 뺀다.
#[tauri::command(async)]
pub fn pack_deck(dir: String, out: String) -> Res<()> {
	let root = PathBuf::from(&dir);
	let file = std::fs::File::create(&out).map_err(err)?;
	let mut zw = zip::ZipWriter::new(file);
	let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
	let mut stack = vec![root.clone()];
	while let Some(d) = stack.pop() {
		for e in std::fs::read_dir(&d).map_err(err)?.flatten() {
			let p = e.path();
			let rel = p.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
			if rel.starts_with(".claudeppt/run") {
				continue;
			}
			if p.is_dir() {
				zw.add_directory(format!("{rel}/"), opt).map_err(err)?;
				stack.push(p);
			} else {
				zw.start_file(rel, opt).map_err(err)?;
				let mut buf = vec![];
				std::fs::File::open(&p).map_err(err)?.read_to_end(&mut buf).map_err(err)?;
				zw.write_all(&buf).map_err(err)?;
			}
		}
	}
	zw.finish().map_err(err)?;
	Ok(())
}

/// .cppt 를 dest 폴더에 푼다. dest 가 이미 있으면 뒤에 번호를 붙인다. 푼 폴더 경로를 돌려준다.
#[tauri::command(async)]
pub fn unpack_deck(file: String, dest: String) -> Res<String> {
	let mut target = PathBuf::from(&dest);
	let mut n = 2;
	while target.exists() {
		target = PathBuf::from(format!("{dest} {n}"));
		n += 1;
	}
	let mut za = zip::ZipArchive::new(std::fs::File::open(&file).map_err(err)?).map_err(err)?;
	for i in 0..za.len() {
		let mut f = za.by_index(i).map_err(err)?;
		let Some(name) = f.enclosed_name() else { continue };
		let p = target.join(name);
		if f.is_dir() {
			std::fs::create_dir_all(&p).map_err(err)?;
			continue;
		}
		if let Some(d) = p.parent() {
			std::fs::create_dir_all(d).map_err(err)?;
		}
		let mut buf = vec![];
		f.read_to_end(&mut buf).map_err(err)?;
		std::fs::write(&p, buf).map_err(err)?;
	}
	if !target.join("deck.json").exists() {
		return Err("묶음 안에 deck.json 이 없다".into());
	}
	Ok(target.to_string_lossy().into())
}

/// 탐색기에서 폴더를 연다.
/// 덱 폴더를 휴지통으로 — 처음 화면의 「지우기」. 바로 지우지 않아 휴지통에서 되살릴 수 있다.
/// deck.json 이 있는 절대 경로의 폴더만 받는다 — 저장 폴더 자체 · 드라이브 · 다른 폴더가 잘못 넘어와도 지우지 않게
#[tauri::command(async)]
pub fn deck_trash(dir: String) -> Res<()> {
	let p = Path::new(&dir);
	check_trash(p)?;
	to_trash(p)
}

fn check_trash(p: &Path) -> Res<()> {
	if !p.is_absolute() || p.parent().is_none() {
		return Err("지울 수 없는 자리다".into());
	}
	if !p.join("deck.json").is_file() {
		return Err("덱 폴더가 아니다 (deck.json 이 없다)".into());
	}
	Ok(())
}

/// 윈도 휴지통으로 옮긴다 (SHFileOperationW + FOF_ALLOWUNDO). 묻는 창 · 오류 창은 앱이 띄우므로 끈다
#[cfg(windows)]
fn to_trash(p: &Path) -> Res<()> {
	use std::os::windows::ffi::OsStrExt;
	use windows_sys::Win32::UI::Shell::{FO_DELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, SHFILEOPSTRUCTW, SHFileOperationW};
	// pFrom 은 이름들을 NUL 로 잇고 NUL 둘로 끝나는 꼴이다
	let mut from: Vec<u16> = p.as_os_str().encode_wide().collect();
	from.extend([0, 0]);
	let mut op: SHFILEOPSTRUCTW = unsafe { std::mem::zeroed() };
	op.wFunc = FO_DELETE;
	op.pFrom = from.as_ptr();
	op.fFlags = (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT) as _;
	let r = unsafe { SHFileOperationW(&mut op) };
	if r != 0 || op.fAnyOperationsAborted != 0 {
		return Err(format!("휴지통으로 옮기지 못했다 (코드 {r})"));
	}
	Ok(())
}

#[cfg(not(windows))]
fn to_trash(_p: &Path) -> Res<()> {
	Err("휴지통으로 옮기기는 Windows 에서만 된다".into())
}

#[tauri::command]
pub fn reveal(path: String) -> Res<()> {
	let p = Path::new(&path);
	let mut cmd = std::process::Command::new("explorer");
	if p.is_file() { cmd.arg(format!("/select,{}", p.display())) } else { cmd.arg(p) };
	cmd.spawn().map_err(err)?;
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	/// 휴지통으로 보내는 것은 deck.json 이 있는 절대 경로 폴더만 — 저장 폴더 · 드라이브 · 상대 경로는 거절
	#[test]
	fn trash_takes_only_deck_folders() {
		let d = std::env::temp_dir().join(format!("cppt-trash-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&d);
		std::fs::create_dir_all(&d).unwrap();
		assert!(check_trash(&d).is_err(), "deck.json 없는 폴더");
		assert!(check_trash(Path::new("relative/deck")).is_err(), "상대 경로");
		#[cfg(windows)]
		assert!(check_trash(Path::new("C:\\")).is_err(), "드라이브");
		std::fs::write(d.join("deck.json"), "{}").unwrap();
		assert!(check_trash(&d).is_ok());
		let _ = std::fs::remove_dir_all(&d);
	}
}
