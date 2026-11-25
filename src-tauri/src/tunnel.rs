// 바깥 길 — 협업 서버를 사무실 밖에서도 같은 링크로 열게 한다. 깔린 도구를 찾아 쓴다 (없으면 사무실 망 안에서만).
//
//   Tailscale Funnel   tailscale funnel --bg --https=443 http://127.0.0.1:<포트>  → https://<기기>.<tailnet>.ts.net
//                      tailnet 관리자가 Funnel 을 허락해 두어야 한다. 끌 때 --https=443 off (사용자의 다른 Funnel 설정은 건드리지 않는다)
//   Cloudflare         cloudflared tunnel --url http://127.0.0.1:<포트>  → https://<무작위>.trycloudflare.com (켤 때마다 주소가 바뀐다)
//                      계정 없이 된다. 앱이 띄운 프로세스라 앱의 job 에 넣어 앱과 함께 꺼진다
// 터널로 온 요청은 127.0.0.1 에서 온 것으로 보인다 — 서버는 IP 로 믿지 않고 기기 쿠키만 본다 (collab.rs)

use crate::{Res, err};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Serialize, Clone)]
pub struct Tools {
	pub tailscale: Option<String>,
	pub cloudflared: Option<String>,
}

/// 실행 파일 찾기 — PATH 다음에 깐 방법마다 놓이는 자리
fn find(exe: &str, places: &[PathBuf]) -> Option<PathBuf> {
	let mut c = std::process::Command::new("where");
	crate::hidden(&mut c);
	if let Ok(o) = c.arg(exe).output() {
		if let Some(l) = String::from_utf8_lossy(&o.stdout).lines().map(str::trim).find(|l| l.to_ascii_lowercase().ends_with(".exe")) {
			return Some(PathBuf::from(l));
		}
	}
	places.iter().find(|p| p.is_file()).cloned()
}

fn env(k: &str) -> PathBuf {
	std::env::var_os(k).map(PathBuf::from).unwrap_or_default()
}

pub fn detect() -> Tools {
	let ts = find("tailscale.exe", &[env("ProgramFiles").join("Tailscale").join("tailscale.exe")]);
	let cf = find(
		"cloudflared.exe",
		&[
			env("ProgramFiles(x86)").join("cloudflared").join("cloudflared.exe"),
			env("ProgramFiles").join("cloudflared").join("cloudflared.exe"),
			env("LOCALAPPDATA").join("Microsoft").join("WinGet").join("Links").join("cloudflared.exe"),
			env("USERPROFILE").join("scoop").join("shims").join("cloudflared.exe"),
		],
	);
	Tools { tailscale: ts.map(|p| p.to_string_lossy().into()), cloudflared: cf.map(|p| p.to_string_lossy().into()) }
}

/// cloudflared 가 찍는 줄에서 quick tunnel 주소를 찾는다
pub fn trycloudflare_url(line: &str) -> Option<String> {
	let i = line.find("https://")?;
	let url: String = line[i..].chars().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '/' | '.' | '-')).collect();
	let host = url.trim_start_matches("https://");
	(host.ends_with(".trycloudflare.com") && host.len() > ".trycloudflare.com".len() && !host.starts_with("api.")).then_some(url)
}

/// tailscale status --json 의 Self.DNSName → https 주소
pub fn tailscale_url(status_json: &str) -> Option<String> {
	let v: serde_json::Value = serde_json::from_str(status_json).ok()?;
	let dns = v["Self"]["DNSName"].as_str()?.trim_end_matches('.');
	(!dns.is_empty()).then(|| format!("https://{dns}"))
}

/// 열린 바깥 길
pub enum Open {
	Tailscale { exe: PathBuf },
	Cloudflare { child: tokio::process::Child },
}

pub struct Tunnel {
	pub url: String,
	pub kind: &'static str,
	pub open: Open,
}

/// 바깥 길을 연다 — Tailscale 이 있으면 먼저(주소가 바뀌지 않는다), 없으면 cloudflared
pub async fn start(port: u16) -> Res<Tunnel> {
	let t = detect();
	if let Some(exe) = t.tailscale.map(PathBuf::from) {
		match tailscale_on(&exe, port).await {
			Ok(url) => return Ok(Tunnel { url, kind: "tailscale", open: Open::Tailscale { exe } }),
			Err(e) if t.cloudflared.is_none() => return Err(format!("Tailscale Funnel 을 열지 못했다: {e}")),
			Err(_) => {}
		}
	}
	let exe = t.cloudflared.map(PathBuf::from).ok_or("Tailscale 도 cloudflared 도 깔려 있지 않다")?;
	cloudflare_on(&exe, port).await
}

async fn run(exe: &Path, args: &[&str]) -> Res<String> {
	let mut c = tokio::process::Command::new(exe);
	c.args(args).stdin(Stdio::null());
	#[cfg(windows)]
	c.creation_flags(0x0800_0000);
	let o = tokio::time::timeout(std::time::Duration::from_secs(30), c.output()).await.map_err(|_| "30초 안에 끝나지 않았다".to_string())?.map_err(err)?;
	if !o.status.success() {
		return Err(String::from_utf8_lossy(&o.stderr).trim().to_string());
	}
	Ok(String::from_utf8_lossy(&o.stdout).to_string())
}

async fn tailscale_on(exe: &Path, port: u16) -> Res<String> {
	run(exe, &["funnel", "--bg", "--https=443", &format!("http://127.0.0.1:{port}")]).await?;
	let status = run(exe, &["status", "--json"]).await?;
	tailscale_url(&status).ok_or("tailscale 주소를 읽지 못했다".into())
}

async fn cloudflare_on(exe: &Path, port: u16) -> Res<Tunnel> {
	let mut c = tokio::process::Command::new(exe);
	c.args(["tunnel", "--no-autoupdate", "--url", &format!("http://127.0.0.1:{port}")]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).kill_on_drop(true);
	#[cfg(windows)]
	c.creation_flags(0x0800_0000);
	let mut child = c.spawn().map_err(|e| format!("cloudflared 를 띄우지 못했다: {e}"))?;
	crate::claude::adopt(&child);
	let mut lines = BufReader::new(child.stderr.take().unwrap()).lines();
	// 주소는 stderr 로 나온다. 30초 안에 안 나오면 접는다
	let found = tokio::time::timeout(std::time::Duration::from_secs(30), async {
		while let Ok(Some(l)) = lines.next_line().await {
			if let Some(u) = trycloudflare_url(&l) {
				return Some(u);
			}
		}
		None
	})
	.await
	.ok()
	.flatten();
	let Some(url) = found else {
		let _ = child.kill().await;
		return Err("cloudflared 가 주소를 내주지 않았다".into());
	};
	// 남은 출력은 버린다 — 읽지 않으면 파이프가 차서 cloudflared 가 멈춘다
	tauri::async_runtime::spawn(async move { while let Ok(Some(_)) = lines.next_line().await {} });
	Ok(Tunnel { url, kind: "cloudflare", open: Open::Cloudflare { child } })
}

/// 바깥 길을 닫는다
pub async fn stop(t: Tunnel) {
	match t.open {
		Open::Tailscale { exe } => {
			let _ = run(&exe, &["funnel", "--https=443", "off"]).await;
		}
		Open::Cloudflare { mut child } => {
			let _ = child.kill().await;
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reads_quick_tunnel_address() {
		let l = "2026-11-25T11:00:00Z INF |  https://plain-dog-river-abc.trycloudflare.com                                  |";
		assert_eq!(trycloudflare_url(l).as_deref(), Some("https://plain-dog-river-abc.trycloudflare.com"));
		assert_eq!(trycloudflare_url("INF Requesting new quick Tunnel on trycloudflare.com..."), None);
		assert_eq!(trycloudflare_url("see https://api.trycloudflare.com/tunnel"), None);
		assert_eq!(trycloudflare_url("https://example.com"), None);
	}

	/// 가짜 cloudflared(.cmd) — 주소를 stderr 로 찍고 기다린다. 띄우기 · 주소 읽기 · 끄기 길을 깔린 도구 없이 본다
	#[cfg(windows)]
	#[tokio::test]
	async fn starts_reads_and_stops_a_quick_tunnel() {
		let d = std::env::temp_dir().join(format!("cppt-tunnel-{}", std::process::id()));
		std::fs::create_dir_all(&d).unwrap();
		let exe = d.join("fake-cloudflared.cmd");
		std::fs::write(&exe, "@echo off
echo INF Requesting new quick Tunnel on trycloudflare.com... 1>&2
echo INF ^|  https://quiet-fox-123.trycloudflare.com  ^| 1>&2
ping -n 20 127.0.0.1 > nul
").unwrap();
		let t = cloudflare_on(&exe, 47999).await.expect("주소를 읽어야 한다");
		assert_eq!(t.url, "https://quiet-fox-123.trycloudflare.com");
		assert_eq!(t.kind, "cloudflare");
		let Open::Cloudflare { ref child } = t.open else { panic!() };
		let pid = child.id().unwrap();
		stop(t).await;
		let alive = std::process::Command::new("tasklist").args(["/FI", &format!("PID eq {pid}"), "/NH"]).output().unwrap();
		assert!(!String::from_utf8_lossy(&alive.stdout).contains(&pid.to_string()), "끈 뒤에도 남았다");
		let _ = std::fs::remove_dir_all(d);
	}

	#[test]
	fn reads_tailscale_name() {
		let j = r#"{"Self":{"DNSName":"host-pc.tail1234.ts.net.","HostName":"host-pc"}}"#;
		assert_eq!(tailscale_url(j).as_deref(), Some("https://host-pc.tail1234.ts.net"));
		assert_eq!(tailscale_url(r#"{"Self":{"DNSName":""}}"#), None);
		assert_eq!(tailscale_url("not json"), None);
	}
}
