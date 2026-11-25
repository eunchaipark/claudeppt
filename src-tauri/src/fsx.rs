// 프로젝트 폴더 안 파일 읽기 · 쓰기. 모든 경로는 프로젝트 폴더(root) 기준 상대 경로이고, 밖으로 나가지 못한다.
// abs_* 만 사용자가 대화 상자로 고른 절대 경로(PPTX 가져오기 · 내보내기)를 다룬다.

use crate::{Res, err};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use std::path::{Component, Path, PathBuf};

pub fn inside(root: &str, rel: &str) -> Res<PathBuf> {
	let rel = Path::new(rel);
	if rel.is_absolute() || rel.components().any(|c| matches!(c, Component::ParentDir | Component::Prefix(_))) {
		return Err(format!("프로젝트 밖 경로: {}", rel.display()));
	}
	Ok(Path::new(root).join(rel))
}

fn ensure_parent(p: &Path) -> Res<()> {
	if let Some(d) = p.parent() {
		std::fs::create_dir_all(d).map_err(err)?;
	}
	Ok(())
}

/// 클립보드의 글. 비었거나 글이 아니면 빈 문자열
#[tauri::command]
pub fn clip_text() -> Res<String> {
	arboard::Clipboard::new().and_then(|mut c| c.get_text()).or_else(|e| if matches!(e, arboard::Error::ContentNotAvailable) { Ok(String::new()) } else { Err(err(e)) })
}

#[tauri::command]
pub fn fs_read_text(root: String, rel: String) -> Res<String> {
	std::fs::read_to_string(inside(&root, &rel)?).map_err(err)
}

#[tauri::command]
pub fn fs_write_text(root: String, rel: String, text: String) -> Res<()> {
	let p = inside(&root, &rel)?;
	ensure_parent(&p)?;
	std::fs::write(p, text).map_err(err)
}

#[tauri::command]
pub fn fs_write_base64(root: String, rel: String, data: String) -> Res<()> {
	let p = inside(&root, &rel)?;
	ensure_parent(&p)?;
	std::fs::write(p, B64.decode(data).map_err(err)?).map_err(err)
}

#[tauri::command]
pub fn fs_exists(root: String, rel: String) -> Res<bool> {
	Ok(inside(&root, &rel)?.exists())
}

/// 큰 파일을 날바이트로 주고받는다. base64 문자열로 오가면 수백 MB PPTX 에서 웹뷰가 메모리를 못 이겨 멈춘다
/// (base64 로 ⅓ 불고 · JSON 문자열로 한 번 더 복사되고 · JS 에서 글자마다 다시 바이트로 바꾼다).
#[tauri::command(async)]
pub fn abs_read_bytes(path: String) -> Res<tauri::ipc::Response> {
	Ok(tauri::ipc::Response::new(std::fs::read(path).map_err(err)?))
}

/// 본문은 날바이트, 경로는 머리글(x-root · x-rel)로 받는다. 머리글은 ASCII 만 되므로 JS 가 encodeURIComponent 로 싸서 보낸다.
#[tauri::command]
pub fn fs_write_bytes(request: tauri::ipc::Request) -> Res<()> {
	let tauri::ipc::InvokeBody::Raw(data) = request.body() else { return Err("본문이 바이트가 아니다".into()) };
	let p = inside(&header(&request, "x-root")?, &header(&request, "x-rel")?)?;
	ensure_parent(&p)?;
	std::fs::write(p, data).map_err(err)
}

/// 사용자가 고른 파일을 프로젝트 안으로 복사한다 — 원본 PPTX 를 JS 로 들였다 내보내지 않으려고.
#[tauri::command(async)]
pub fn abs_copy_in(src: String, root: String, rel: String) -> Res<()> {
	let p = inside(&root, &rel)?;
	ensure_parent(&p)?;
	std::fs::copy(src, p).map(|_| ()).map_err(err)
}

/// 내보낸 PPTX 를 사용자가 고른 자리에 쓴다. 경로는 머리글 x-path (fs_write_bytes 와 같은 꼴).
#[tauri::command]
pub fn abs_write_bytes(request: tauri::ipc::Request) -> Res<()> {
	let tauri::ipc::InvokeBody::Raw(data) = request.body() else { return Err("본문이 바이트가 아니다".into()) };
	let p = PathBuf::from(header(&request, "x-path")?);
	ensure_parent(&p)?;
	std::fs::write(p, data).map_err(err)
}

fn header(request: &tauri::ipc::Request, k: &str) -> Res<String> {
	let v = request.headers().get(k).ok_or_else(|| format!("머리글 없음: {k}"))?;
	Ok(percent_encoding::percent_decode(v.as_bytes()).decode_utf8().map_err(err)?.into_owned())
}
