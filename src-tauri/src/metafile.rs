// EMF · WMF → PNG. 웹뷰는 Windows 그림 파일(EMF · WMF)을 그리지 못해, 가져온 PPTX 의 로고 · 도식이 빈 상자로 남았다 (2026.11.23).
// Windows 의 GDI+ 로 흰 바탕 · 검은 바탕에 한 번씩 그려 두 장의 차이로 투명도를 되살린다 —
// 옛 GDI 명령으로 된 EMF 는 투명 바탕에 바로 그리면 점의 투명도가 0 으로 남아 통째로 보이지 않는다.
//
// 일꾼: PowerShell 을 한 번 띄워 C# 을 한 번 컴파일하고, 한 줄에 한 장씩 받아 바꾼다. 30초 쉬면 끈다.
// 2026.11.25 : 전에는 한 장마다 PowerShell 을 띄우고 Add-Type 으로 C# 을 새로 컴파일해 장마다 0.6초쯤 걸렸다 — EMF 가 많은 PPTX 가져오기가 느렸다.
// 경로는 base64 로 넘긴다 — 스크립트 글에 끼워 넣지 않으니 한글 · 따옴표가 든 경로도 그대로다

use crate::{Res, err};
use base64::Engine;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const CS: &str = r#"
using System; using System.Drawing; using System.Drawing.Drawing2D; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class Mf {
  static byte[] Draw(Metafile mf, int W, int H, Color bg) {
    using (var bm = new Bitmap(W, H, PixelFormat.Format32bppArgb)) {
      using (var g = Graphics.FromImage(bm)) {
        g.Clear(bg); g.SmoothingMode = SmoothingMode.AntiAlias; g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit; g.DrawImage(mf, new Rectangle(0, 0, W, H));
      }
      var d = bm.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      var b = new byte[d.Stride * H]; Marshal.Copy(d.Scan0, b, 0, b.Length); bm.UnlockBits(d); return b;
    }
  }
  public static string Go(string src, string dst, int max) {
    string step = "open";
    try {
    // 경로 대신 스트림으로 연다 — GDI+ 는 한글 · 섞인 구분자(/ \) 경로에서 「일반 오류」를 낸다
    using (var ms = new System.IO.MemoryStream(System.IO.File.ReadAllBytes(System.IO.Path.GetFullPath(src))))
    using (var mf = new Metafile(ms)) {
      step = "draw";
      double w = mf.Width, h = mf.Height, s = max / Math.Max(w, h);
      int W = Math.Max(1, (int)Math.Round(w * s)), H = Math.Max(1, (int)Math.Round(h * s));
      byte[] a = Draw(mf, W, H, Color.White), k = Draw(mf, W, H, Color.Black), o = new byte[a.Length];
      for (int i = 0; i < a.Length; i += 4) {
        int al = 255 - Math.Max(a[i] - k[i], Math.Max(a[i + 1] - k[i + 1], a[i + 2] - k[i + 2]));
        if (al < 0) al = 0; if (al > 255) al = 255;
        o[i + 3] = (byte)al;
        if (al > 0) for (int c = 0; c < 3; c++) o[i + c] = (byte)Math.Min(255, k[i + c] * 255 / al);
      }
      step = "save " + W + "x" + H;
      using (var bm = new Bitmap(W, H, PixelFormat.Format32bppArgb)) {
        var d = bm.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(o, 0, d.Scan0, o.Length); bm.UnlockBits(d);
        // Bitmap.Save 는 경로에 따라 「일반 오류」를 낸다 — 스트림으로 쓴다
        using (var fs = System.IO.File.Create(System.IO.Path.GetFullPath(dst))) bm.Save(fs, ImageFormat.Png);
      }
      return W + "x" + H;
    }
    } catch (Exception e) { throw new Exception(step + ": " + e.Message); }
  }
}
"#;

/// 일꾼이 받는 고리 — 한 줄에 「src(base64)\tdst(base64)\tmax」, 답은 「OK\t<너비>x<높이>」 또는 「ERR\t<까닭(base64)>」
const LOOP: &str = r#"
$ErrorActionPreference='Stop'
$in = New-Object IO.StreamReader([Console]::OpenStandardInput(), [Text.Encoding]::UTF8)
$out = New-Object IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object Text.UTF8Encoding $false))
$out.AutoFlush = $true
$out.WriteLine('READY')
$u = [Text.Encoding]::UTF8
while (($l = $in.ReadLine()) -ne $null) {
  $p = $l.Split([char]9)
  try {
    $r = [Mf]::Go($u.GetString([Convert]::FromBase64String($p[0])), $u.GetString([Convert]::FromBase64String($p[1])), [int]$p[2])
    $out.WriteLine('OK' + [char]9 + $r)
  } catch {
    $m = $_.Exception.Message; if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
    $out.WriteLine('ERR' + [char]9 + [Convert]::ToBase64String($u.GetBytes($m)))
  }
}
"#;

/// 쉬면 끄는 시간 — 가져오기 한 번 동안은 살아 있고, 끝나면 메모리를 돌려준다
const IDLE: Duration = Duration::from_secs(30);

struct Worker {
	child: Child,
	stdin: ChildStdin,
	stdout: BufReader<ChildStdout>,
	last: Instant,
}

impl Drop for Worker {
	fn drop(&mut self) {
		let _ = self.child.kill();
		let _ = self.child.wait();
	}
}

static WORKER: Mutex<Option<Worker>> = Mutex::new(None);

fn spawn() -> Res<Worker> {
	let script = format!("$ErrorActionPreference='Stop'; Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'\n{CS}\n'@\n{LOOP}");
	let mut c = std::process::Command::new("powershell");
	crate::hidden(&mut c);
	let mut child = c
		.args(["-NoProfile", "-NonInteractive", "-Command", &script])
		.stdin(Stdio::piped())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.spawn()
		.map_err(|e| format!("PowerShell 을 띄우지 못했다: {e}"))?;
	let stdin = child.stdin.take().unwrap();
	let mut stdout = BufReader::new(child.stdout.take().unwrap());
	let mut first = String::new();
	stdout.read_line(&mut first).map_err(err)?;
	if first.trim() != "READY" {
		let mut e = Vec::new();
		if let Some(mut se) = child.stderr.take() {
			let _ = std::io::Read::read_to_end(&mut se, &mut e);
		}
		let _ = child.kill();
		return Err(crate::fonts::decode(&e).lines().find(|l| !l.trim().is_empty()).unwrap_or("EMF 일꾼이 뜨지 않았다").to_string());
	}
	// 쉬는 일꾼을 끈다 — 지켜보는 스레드는 일꾼이 없어지면 끝난다
	std::thread::spawn(|| loop {
		std::thread::sleep(Duration::from_secs(5));
		let mut w = WORKER.lock().unwrap();
		match &*w {
			Some(x) if x.last.elapsed() > IDLE => {
				*w = None;
				return;
			}
			Some(_) => {}
			None => return,
		}
	});
	Ok(Worker { child, stdin, stdout, last: Instant::now() })
}

fn convert(w: &mut Worker, src: &str, dst: &str, max: u32) -> Res<String> {
	let b = base64::engine::general_purpose::STANDARD;
	writeln!(w.stdin, "{}\t{}\t{}", b.encode(src), b.encode(dst), max).map_err(err)?;
	w.stdin.flush().map_err(err)?;
	let mut line = String::new();
	if w.stdout.read_line(&mut line).map_err(err)? == 0 {
		return Err("EMF 일꾼이 끝나 버렸다".into());
	}
	w.last = Instant::now();
	let (k, v) = line.trim_end().split_once('\t').unwrap_or(("ERR", ""));
	if k == "OK" {
		return Ok(v.to_string());
	}
	let msg = b.decode(v).ok().map(|x| String::from_utf8_lossy(&x).to_string()).filter(|m| !m.trim().is_empty());
	Err(msg.unwrap_or_else(|| "EMF 를 그림으로 바꾸지 못했다".into()))
}

/// dir 안 src(EMF · WMF)를 긴 변 max 픽셀 PNG 로 out 에 쓴다. 돌려주는 값은 "<너비>x<높이>"
#[tauri::command]
pub async fn metafile_png(dir: String, src: String, out: String, max: u32) -> Res<String> {
	tokio::task::spawn_blocking(move || {
		let d = PathBuf::from(&dir);
		let (s, o) = (d.join(&src), d.join(&out));
		if let Some(p) = o.parent() {
			std::fs::create_dir_all(p).map_err(err)?;
		}
		let (s, o) = (s.to_string_lossy().to_string(), o.to_string_lossy().to_string());
		let mut g = WORKER.lock().unwrap();
		// 일꾼이 없거나 죽었으면 새로 — 한 번만 다시 해 본다
		for attempt in 0..2 {
			if g.is_none() {
				*g = Some(spawn()?);
			}
			match convert(g.as_mut().unwrap(), &s, &o, max.clamp(16, 4096)) {
				Ok(r) => return Ok(r),
				Err(e) if e.starts_with("EMF 일꾼") || e.contains("파이프") || e.contains("pipe") => {
					*g = None;
					if attempt == 1 {
						return Err(e);
					}
				}
				Err(e) => return Err(e),
			}
		}
		Err("EMF 를 그림으로 바꾸지 못했다".into())
	})
	.await
	.map_err(err)?
}

#[cfg(test)]
mod tests {
	use super::*;

	/// 한글 · 따옴표가 든 폴더에서 EMF 를 여러 장 — 일꾼 하나로 바꾸고, 둘째 장부터는 빨라야 한다
	#[cfg(windows)]
	#[tokio::test]
	async fn converts_many_with_one_worker() {
		let d = std::env::temp_dir().join(format!("cppt-emf '시험' {}", std::process::id()));
		std::fs::create_dir_all(d.join("source")).unwrap();
		let emf = d.join("source").join("a.emf");
		let ps = format!(
			"Add-Type -AssemblyName System.Drawing; $b=New-Object System.Drawing.Bitmap 10,10; $g0=[System.Drawing.Graphics]::FromImage($b); $h=$g0.GetHdc(); $m=New-Object System.Drawing.Imaging.Metafile('{}', $h); $g0.ReleaseHdc($h); $g=[System.Drawing.Graphics]::FromImage($m); $g.FillEllipse([System.Drawing.Brushes]::SteelBlue,10,10,300,200); $g.Dispose(); $m.Dispose()",
			emf.to_string_lossy().replace('\'', "''")
		);
		let ok = std::process::Command::new("powershell").args(["-NoProfile", "-Command", &ps]).status().unwrap().success();
		assert!(ok, "시험 EMF 를 만들지 못했다");
		let dir = d.to_string_lossy().to_string();
		let mut times = vec![];
		for i in 0..4 {
			let t = Instant::now();
			let r = metafile_png(dir.clone(), "source/a.emf".into(), format!("assets/a{i}.png"), 400).await.unwrap();
			times.push(t.elapsed());
			assert!(r.contains('x'), "{r}");
			assert!(d.join(format!("assets/a{i}.png")).is_file());
		}
		// 없는 파일은 까닭과 함께 실패하고, 일꾼은 그대로 다음 장을 받는다
		assert!(metafile_png(dir.clone(), "source/none.emf".into(), "assets/x.png".into(), 400).await.is_err());
		assert!(metafile_png(dir.clone(), "source/a.emf".into(), "assets/after.png".into(), 400).await.is_ok());
		assert!(times[1..].iter().all(|t| *t < Duration::from_millis(400)), "둘째 장부터 느리다: {times:?}");
		let _ = std::fs::remove_dir_all(d);
	}
}
