// 이 PC 의 글꼴 — 가져온 PPTX 가 PowerPoint 와 똑같은 글꼴로 보이게 하고, 없는 글꼴은 받아 깐다.
//
// 목차
//   font_index    깔린 글꼴 파일마다 이름(모든 나라말) · 영어 전체 이름 · 굵게/기울임을 읽는다
//   font_install  주소에서 글꼴(zip · ttf · otf)을 받아 사용자 글꼴로 깐다 — 관리자 권한이 필요 없다
//   decode        콘솔 출력(CP949) 읽기 — pptsnap 도 쓴다
//
// 왜 이름 표를 직접 읽는가: PowerPoint 는 글꼴을 한글 이름(「에스코어 드림 5 Medium」)으로 저장하는데,
// 웹뷰(Chromium)는 글꼴 가족 이름으로는 영어 이름만 알아본다 (2026.11.18 에스코어 드림으로 확인).
// 대신 @font-face 의 local("영어 전체 이름")은 알아보므로, 화면은 원본 이름을 그대로 두고 이 별칭으로 잇는다.

use crate::{Res, err, hidden};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct Face {
	/// 글꼴 파일 경로
	file: String,
	/// 가족 이름 (이름 1) — 나라말마다. PowerPoint 가 저장하는 이름이 이것이다
	family: Vec<String>,
	/// 전체 이름 (이름 4) 과 선호 가족 + 선호 모양 (이름 16 + 17) — 나라말마다
	full: Vec<String>,
	/// local() 에 쓸 영어 전체 이름
	local: String,
	bold: bool,
	italic: bool,
	/// 굵기 (OS/2 usWeightClass) — 이 값이 600 아래인 글꼴에 「굵게」를 주면 PowerPoint 도 웹뷰도 굵기를 흉내 낸다
	weight: u16,
	/// 세로 지표(em 비율) — [winAscent, winDescent, typoAscender, typoDescender(양수), typoLineGap].
	/// PowerPoint 는 win 값으로 첫 줄 기준선을 잡고, 웹뷰(DirectWrite)도 typo 표시가 없으면 win 값으로 글줄 높이를 잡는다.
	/// 둘의 차이만큼 문단이 위아래로 어긋나므로 가져오기가 이것으로 문단 자리를 고친다
	metrics: [f32; 5],
	/// OS/2 fsSelection 의 USE_TYPO_METRICS — 켜져 있으면 웹뷰가 win 대신 typo 값을 쓴다
	typo: bool,
}

fn font_dirs() -> Vec<PathBuf> {
	let mut d = vec![PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into())).join("Fonts")];
	if let Ok(l) = std::env::var("LOCALAPPDATA") {
		d.push(user_font_dir_of(&l));
	}
	d
}
fn user_font_dir_of(local_app_data: &str) -> PathBuf {
	PathBuf::from(local_app_data).join(r"Microsoft\Windows\Fonts")
}

#[tauri::command]
pub async fn font_index() -> Res<Vec<Face>> {
	tokio::task::spawn_blocking(|| {
		let mut out = vec![];
		for d in font_dirs() {
			let Ok(rd) = std::fs::read_dir(d) else { continue };
			for e in rd.flatten() {
				let p = e.path();
				if is_font_file(&p) {
					// 깨진 글꼴 파일 하나 때문에 나머지를 못 읽으면 안 된다
					let _ = faces_of(&p, &mut out);
				}
			}
		}
		Ok(out)
	})
	.await
	.map_err(err)?
}

fn is_font_file(p: &Path) -> bool {
	let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
	matches!(ext.as_str(), "ttf" | "otf" | "ttc")
}

/// 글꼴 파일(묶음 ttc 포함)에서 글꼴마다 이름 표를 읽는다. 파일 전체가 아니라 머리와 name 표만 읽는다 (CJK 글꼴은 수십 MB 다).
fn faces_of(p: &Path, out: &mut Vec<Face>) -> std::io::Result<()> {
	let mut f = std::fs::File::open(p)?;
	let mut at = |off: u64, n: usize| -> std::io::Result<Vec<u8>> {
		let mut b = vec![0u8; n];
		f.seek(SeekFrom::Start(off))?;
		f.read_exact(&mut b)?;
		Ok(b)
	};
	let head = at(0, 12)?;
	let bases: Vec<u64> = if &head[0..4] == b"ttcf" {
		let n = be32(&head, 8).min(64) as usize;
		let offs = at(12, n * 4)?;
		(0..n).map(|i| be32(&offs, i * 4)).collect()
	} else {
		vec![0]
	};
	for base in bases {
		let h = at(base, 12)?;
		let n = be16(&h, 4);
		let recs = at(base + 12, n * 16)?;
		let table = |tag: &[u8]| (0..n).find(|i| &recs[i * 16..i * 16 + 4] == tag).map(|i| (be32(&recs, i * 16 + 8), be32(&recs, i * 16 + 12) as usize));
		let Some((off, len)) = table(b"name") else { continue };
		let t = at(off, len.min(1 << 20))?;
		let Some(mut face) = face_of_name_table(&t, p) else { continue };
		// 세로 지표 — head 의 unitsPerEm 과 OS/2 표. 없거나 짧으면 0 으로 두고, 가져오기는 그 글꼴의 자리를 고치지 않는다
		if let (Some((ho, hl)), Some((oo, ol))) = (table(b"head"), table(b"OS/2")) {
			if hl >= 20 && ol >= 78 {
				let upm = be16(&at(ho, 20)?, 18).max(1) as f32;
				let o = at(oo, 78)?;
				let s16 = |i: usize| i16::from_be_bytes([o[i], o[i + 1]]) as f32 / upm;
				face.weight = be16(&o, 4) as u16;
				face.typo = be16(&o, 62) & 0x80 != 0;
				face.metrics = [be16(&o, 74) as f32 / upm, be16(&o, 76) as f32 / upm, s16(68), -s16(70), s16(72)];
			}
		}
		out.push(face);
	}
	Ok(())
}

fn face_of_name_table(t: &[u8], p: &Path) -> Option<Face> {
	if t.len() < 6 {
		return None;
	}
	let (count, store) = (be16(t, 2), be16(t, 4));
	let mut by: HashMap<(usize, usize), String> = HashMap::new(); // (이름 번호, 나라말) → 글
	for r in 0..count {
		let o = 6 + r * 12;
		if o + 12 > t.len() {
			break;
		}
		// Windows 이름(플랫폼 3)만 본다 — UTF-16BE 이고, PowerPoint · 웹뷰가 이 이름으로 찾는다
		let (plat, lang, id, l, so) = (be16(t, o), be16(t, o + 4), be16(t, o + 6), be16(t, o + 8), be16(t, o + 10));
		if plat != 3 || !matches!(id, 1 | 2 | 4 | 16 | 17) || store + so + l > t.len() {
			continue;
		}
		let u: Vec<u16> = t[store + so..store + so + l].chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
		let s = String::from_utf16_lossy(&u).trim().to_string();
		if !s.is_empty() {
			by.insert((id, lang), s);
		}
	}
	let pick = |id: usize| by.get(&(id, 0x409)).or_else(|| by.iter().find(|((i, _), _)| *i == id).map(|(_, v)| v)).cloned();
	let all = |id: usize| -> Vec<String> {
		let mut v: Vec<String> = by.iter().filter(|((i, _), _)| *i == id).map(|(_, s)| s.clone()).collect();
		v.sort();
		v.dedup();
		v
	};
	let family = all(1);
	if family.is_empty() {
		return None;
	}
	let style = pick(2).unwrap_or_default().to_ascii_lowercase();
	let mut full = all(4);
	for ((_, lang), fam) in by.iter().filter(|((i, _), _)| *i == 16) {
		if let Some(sub) = by.get(&(17, *lang)).or_else(|| by.get(&(17, 0x409))) {
			full.push(format!("{fam} {sub}"));
		}
	}
	full.sort();
	full.dedup();
	let local = pick(4).unwrap_or_else(|| format!("{} {}", pick(1).unwrap_or_default(), pick(2).unwrap_or_default()).trim().to_string());
	// 굵게 · 기울임은 이름 2(모양)로 가린다 — PowerPoint(GDI)가 한 가족 안에서 보통 · 굵게 · 기울임을 이것으로 고른다
	Some(Face { file: p.to_string_lossy().into(), family, full, local, bold: style.contains("bold"), italic: style.contains("italic") || style.contains("oblique"), weight: 0, metrics: [0.0; 5], typo: false })
}

fn be16(b: &[u8], i: usize) -> usize {
	u16::from_be_bytes([b[i], b[i + 1]]) as usize
}
fn be32(b: &[u8], i: usize) -> u64 {
	u32::from_be_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as u64
}

#[derive(Serialize)]
pub struct Installed {
	url: String,
	/// 깐 글꼴 파일 경로 (이미 깔려 있던 것도 넣는다)
	files: Vec<String>,
	error: Option<String>,
}

/// 주소마다 받아서 깐다. zip 이면 안의 ttf · otf 를 모두 깐다.
/// 받은 것이 글꼴이 아니면(웹 페이지 등) 깔지 않고 error 에 적는다 — 주소는 Claude 가 찾은 것이라 틀릴 수 있다.
#[tauri::command]
pub async fn font_install(urls: Vec<String>) -> Res<Vec<Installed>> {
	let client = reqwest::Client::builder().user_agent("ClaudePPT font installer").build().map_err(err)?;
	let mut out = vec![];
	for url in urls {
		let r = fetch_and_install(&client, &url).await;
		out.push(match r {
			Ok(files) => Installed { url, files, error: None },
			Err(e) => Installed { url, files: vec![], error: Some(e) },
		});
	}
	Ok(out)
}

const MAX_DOWNLOAD: usize = 200 * 1024 * 1024;

async fn fetch_and_install(client: &reqwest::Client, url: &str) -> Res<Vec<String>> {
	if !url.starts_with("https://") {
		return Err("https 주소만 받는다".into());
	}
	let res = client.get(url).send().await.map_err(err)?;
	if !res.status().is_success() {
		return Err(format!("받기 실패: {}", res.status()));
	}
	let bytes = res.bytes().await.map_err(err)?;
	if bytes.len() > MAX_DOWNLOAD {
		return Err("파일이 너무 크다".into());
	}
	let name = url.rsplit('/').next().unwrap_or("font").split(['?', '#']).next().unwrap_or("font").to_string();
	let mut fonts: Vec<(String, Vec<u8>)> = vec![];
	if bytes.starts_with(b"PK\x03\x04") {
		let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes.to_vec())).map_err(err)?;
		for i in 0..z.len() {
			let mut e = z.by_index(i).map_err(err)?;
			// zip 9: 이름이 UTF-8 로 읽히지 않으면 Err — 그 항목은 건너뛴다
			let Ok(n) = e.name().map(|n| n.replace('\\', "/")) else { continue };
			if n.contains("__MACOSX") || !is_font_file(Path::new(&n)) {
				continue;
			}
			let mut b = vec![];
			e.read_to_end(&mut b).map_err(err)?;
			fonts.push((n.rsplit('/').next().unwrap_or(&n).to_string(), b));
		}
	} else {
		fonts.push((name, bytes.to_vec()));
	}
	fonts.retain(|(_, b)| looks_like_font(b));
	if fonts.is_empty() {
		return Err("받은 것에 글꼴 파일(ttf · otf)이 없다".into());
	}
	let mut done = vec![];
	for (n, b) in fonts {
		done.push(install_one(&n, &b)?);
	}
	Ok(done)
}

fn looks_like_font(b: &[u8]) -> bool {
	b.len() > 12 && (b.starts_with(&[0, 1, 0, 0]) || b.starts_with(b"OTTO") || b.starts_with(b"true") || b.starts_with(b"ttcf"))
}

/// 사용자 글꼴 폴더에 쓰고 HKCU 글꼴 목록에 올린 뒤, 켜진 프로그램들에 글꼴이 바뀌었다고 알린다.
/// 같은 이름 파일이 이미 있으면 덮지 않는다 — 쓰던 글꼴을 다른 판으로 바꿔 버리지 않게.
fn install_one(file_name: &str, b: &[u8]) -> Res<String> {
	let dir = user_font_dir_of(&std::env::var("LOCALAPPDATA").map_err(err)?);
	std::fs::create_dir_all(&dir).map_err(err)?;
	let safe: String = file_name.chars().map(|c| if r#"\/:*?"<>|"#.contains(c) { '_' } else { c }).collect();
	let dest = dir.join(&safe);
	if dest.exists() {
		return Ok(dest.to_string_lossy().into());
	}
	std::fs::write(&dest, b).map_err(err)?;
	let mut faces = vec![];
	let _ = faces_of(&dest, &mut faces);
	let label = faces.first().map(|f| f.local.clone()).unwrap_or_else(|| safe.clone());
	let kind = if b.starts_with(b"OTTO") { "OpenType" } else { "TrueType" };
	let mut c = std::process::Command::new("reg");
	hidden(&mut c);
	let ok = c
		.args(["add", r"HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts", "/v", &format!("{label} ({kind})"), "/t", "REG_SZ", "/d", &dest.to_string_lossy(), "/f"])
		.status()
		.map(|s| s.success())
		.unwrap_or(false);
	if !ok {
		return Err(format!("글꼴 목록에 올리지 못했다: {label}"));
	}
	announce(&dest);
	Ok(dest.to_string_lossy().into())
}

#[cfg(windows)]
fn announce(p: &Path) {
	use std::os::windows::ffi::OsStrExt;
	#[link(name = "gdi32")]
	unsafe extern "system" {
		fn AddFontResourceW(name: *const u16) -> i32;
	}
	#[link(name = "user32")]
	unsafe extern "system" {
		fn PostMessageW(hwnd: isize, msg: u32, w: usize, l: isize) -> i32;
	}
	let w: Vec<u16> = p.as_os_str().encode_wide().chain([0]).collect();
	// HWND_BROADCAST · WM_FONTCHANGE — 켜진 PowerPoint 도 다시 켜지 않고 새 글꼴을 본다
	unsafe {
		AddFontResourceW(w.as_ptr());
		PostMessageW(0xffff, 0x001D, 0, 0);
	}
}
#[cfg(not(windows))]
fn announce(_: &Path) {}

/// UTF-8 이 아니면 CP949 로 본다. 한글 글꼴 이름(「맑은 고딕」)이 깨지지 않게.
pub fn decode(b: &[u8]) -> String {
	if let Ok(s) = std::str::from_utf8(b) {
		return s.to_string();
	}
	#[cfg(windows)]
	{
		use std::os::windows::ffi::OsStringExt;
		unsafe extern "system" {
			fn MultiByteToWideChar(cp: u32, flags: u32, src: *const u8, n: i32, dst: *mut u16, m: i32) -> i32;
		}
		// CP_OEMCP(1) — reg 가 쓰는 콘솔 코드 페이지
		let n = unsafe { MultiByteToWideChar(1, 0, b.as_ptr(), b.len() as i32, std::ptr::null_mut(), 0) };
		if n > 0 {
			let mut w = vec![0u16; n as usize];
			unsafe { MultiByteToWideChar(1, 0, b.as_ptr(), b.len() as i32, w.as_mut_ptr(), n) };
			return std::ffi::OsString::from_wide(&w).to_string_lossy().into_owned();
		}
	}
	String::from_utf8_lossy(b).into_owned()
}

#[cfg(test)]
mod tests {
	// 한국어 Windows 라면 맑은 고딕은 늘 깔려 있다 — 한글 가족 이름 · 굵게 판 · 영어 전체 이름을 읽는지 본다
	#[test]
	fn reads_korean_family_and_bold_face() {
		let faces = tauri::async_runtime::block_on(super::font_index()).unwrap();
		let mg: Vec<_> = faces.iter().filter(|f| f.family.iter().any(|n| n == "맑은 고딕")).collect();
		assert!(mg.iter().any(|f| !f.bold && f.local == "Malgun Gothic"), "보통");
		assert!(mg.iter().any(|f| f.bold && f.local == "Malgun Gothic Bold"), "굵게");
		let r = mg.iter().find(|f| f.local == "Malgun Gothic").unwrap();
		assert!((r.metrics[0] - 2229.0 / 2048.0).abs() < 1e-4 && (r.metrics[1] - 495.0 / 2048.0).abs() < 1e-4 && r.weight == 400, "세로 지표 {:?}", r.metrics);
		for f in faces.iter().filter(|f| f.family.iter().any(|n| n.starts_with("에스코어 드림 5"))) {
			println!("{:?} → local({}) bold={}", f.family, f.local, f.bold);
		}
		println!("글꼴 {} 개", faces.len());
	}
}
