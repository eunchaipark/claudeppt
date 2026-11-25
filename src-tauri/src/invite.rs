// 협업 초대 장부 — 링크 · 들어온 기기 · 잠금. 앱 데이터 폴더의 collab.json 에 둔다 (덱 폴더 · .cppt 에는 들지 않는다).
//
//   링크   공용: 들어올 때 이름을 한 번 적는다(여럿이 같이 쓴다) · 개인: 만들 때 정한 이름으로 바로 들어온다.
//          만료를 둘 수 있다. 호스트가 다음 날에도 같은 링크를 다시 복사할 수 있게 링크 열쇠는 그대로 둔다 — 이 PC 앱 데이터에만 있다
//   기기   링크로 들어온 브라우저 하나. 기기 열쇠(쿠키)는 SHA-256 해시로만 둔다 — 파일이 새어도 그 브라우저인 척 못 한다.
//          한 번 들어오면 링크가 만료되거나 지워져도 그 기기는 그대로 들어온다(줌처럼). 내보내면 그 기기 열쇠가 지워진다
//   잠금   켜면 새 기기가 들어오지 못한다. 이미 들어온 기기는 그대로

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Book {
	#[serde(default)]
	pub links: Vec<Link>,
	#[serde(default)]
	pub devices: Vec<Device>,
	#[serde(default)]
	pub locked: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Link {
	pub id: String,
	pub token: String,
	/// 개인 링크면 그 사람 이름. None 이면 공용
	pub name: Option<String>,
	pub created: i64,
	pub expires: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Device {
	pub id: String,
	pub hash: String,
	pub name: String,
	/// 들어온 링크 id
	pub link: String,
	pub created: i64,
	pub seen: i64,
}

#[derive(Debug, PartialEq)]
pub enum Why {
	Unknown,
	Expired,
	Locked,
}

pub fn hash(secret: &str) -> String {
	Sha256::digest(secret.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn random() -> String {
	format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

/// 이름 다듬기 — 앞뒤 빈칸 · 제어 문자를 빼고 40자까지
pub fn clean_name(s: &str) -> String {
	s.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(40).collect()
}

impl Book {
	pub fn load(path: &Path) -> Book {
		std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
	}

	pub fn save(&self, path: &Path) {
		if let Some(d) = path.parent() {
			let _ = std::fs::create_dir_all(d);
		}
		let _ = std::fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default());
	}

	/// 공용 링크가 없으면 하나 만든다 — 켜자마자 나눌 링크가 있게
	pub fn ensure_public(&mut self, now: i64) {
		if !self.links.iter().any(|l| l.name.is_none() && l.expires.is_none_or(|e| e > now)) {
			self.new_link(None, None, now);
		}
	}

	pub fn new_link(&mut self, name: Option<String>, hours: Option<u32>, now: i64) -> Link {
		let l = Link {
			id: uuid::Uuid::new_v4().simple().to_string()[..8].to_string(),
			token: random(),
			name: name.map(|n| clean_name(&n)).filter(|n| !n.is_empty()),
			created: now,
			expires: hours.filter(|h| *h > 0).map(|h| now + h as i64 * 3600 * 1000),
		};
		self.links.push(l.clone());
		l
	}

	pub fn remove_link(&mut self, id: &str) {
		self.links.retain(|l| l.id != id);
	}

	/// 링크로 들어올 수 있는가 — 열쇠 비교는 길이 · 글자마다 같은 시간
	pub fn link(&self, token: &str, now: i64) -> Result<&Link, Why> {
		let l = self.links.iter().find(|l| same(&l.token, token)).ok_or(Why::Unknown)?;
		if l.expires.is_some_and(|e| e <= now) {
			return Err(Why::Expired);
		}
		if self.locked {
			return Err(Why::Locked);
		}
		Ok(l)
	}

	/// 들어온다 — 기기를 만들고 기기 열쇠(쿠키에 넣을 것)를 돌려준다. 개인 링크는 그 이름, 공용은 적은 이름
	pub fn join(&mut self, link: &Link, name: &str, now: i64) -> (Device, String) {
		let secret = random();
		let name = link.name.clone().unwrap_or_else(|| clean_name(name));
		let d = Device { id: uuid::Uuid::new_v4().simple().to_string()[..10].to_string(), hash: hash(&secret), name, link: link.id.clone(), created: now, seen: now };
		self.devices.push(d.clone());
		(d, secret)
	}

	/// 기기 열쇠로 찾는다 (마지막으로 본 때를 적는다)
	pub fn device(&mut self, secret: &str, now: i64) -> Option<Device> {
		let h = hash(secret);
		let d = self.devices.iter_mut().find(|d| same(&d.hash, &h))?;
		d.seen = now;
		Some(d.clone())
	}

	pub fn remove_device(&mut self, id: &str) -> bool {
		let n = self.devices.len();
		self.devices.retain(|d| d.id != id);
		n != self.devices.len()
	}
}

/// 같은 길이 · 같은 글자인지 — 글자마다 비교 시간을 같게 (열쇠를 한 글자씩 알아내지 못하게)
pub fn same(a: &str, b: &str) -> bool {
	a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn public_link_asks_name_personal_link_fixes_it() {
		let mut b = Book::default();
		b.ensure_public(0);
		assert_eq!(b.links.len(), 1);
		b.ensure_public(0);
		assert_eq!(b.links.len(), 1, "공용 링크는 하나만 만든다");
		let public = b.links[0].clone();
		let (d, secret) = b.join(&public, "  민수\n", 1);
		assert_eq!(d.name, "민수");
		assert_ne!(d.hash, secret, "기기 열쇠는 해시로만 둔다");
		assert_eq!(b.device(&secret, 5).unwrap().seen, 5);
		assert!(b.device("wrong", 5).is_none());
		let personal = b.new_link(Some("지호".into()), None, 1);
		let (d2, _) = b.join(&personal, "아무 이름", 1);
		assert_eq!(d2.name, "지호");
	}

	#[test]
	fn expired_unknown_and_locked_links_are_refused() {
		let mut b = Book::default();
		let l = b.new_link(None, Some(1), 0);
		assert!(b.link(&l.token, 1000).is_ok());
		assert_eq!(b.link(&l.token, 3600 * 1000).err(), Some(Why::Expired));
		assert_eq!(b.link("nope", 0).err(), Some(Why::Unknown));
		let l2 = b.new_link(None, None, 0);
		let (_, secret) = b.join(&l2, "a", 0);
		b.locked = true;
		assert_eq!(b.link(&l2.token, 0).err(), Some(Why::Locked));
		assert!(b.device(&secret, 0).is_some(), "잠가도 이미 들어온 기기는 그대로");
		// 만료된 공용 링크만 있으면 새로 만든다
		let mut c = Book::default();
		c.new_link(None, Some(1), 0);
		c.ensure_public(7200 * 1000);
		assert_eq!(c.links.len(), 2);
	}

	#[test]
	fn kicked_device_cannot_come_back_with_its_cookie() {
		let mut b = Book::default();
		b.ensure_public(0);
		let l = b.links[0].clone();
		let (d, secret) = b.join(&l, "a", 0);
		assert!(b.remove_device(&d.id));
		assert!(b.device(&secret, 0).is_none());
		assert!(!b.remove_device(&d.id));
	}

	#[test]
	fn saves_and_loads() {
		let p = std::env::temp_dir().join(format!("cppt-invite-{}.json", std::process::id()));
		let mut b = Book::default();
		b.ensure_public(0);
		let l = b.links[0].clone();
		let (_, secret) = b.join(&l, "민수", 0);
		b.save(&p);
		let mut c = Book::load(&p);
		assert_eq!(c.device(&secret, 1).unwrap().name, "민수");
		assert!(!std::fs::read_to_string(&p).unwrap().contains(&secret), "기기 열쇠가 파일에 그대로 남지 않는다");
		let _ = std::fs::remove_file(p);
	}

	#[test]
	fn names_are_cleaned() {
		assert_eq!(clean_name(" 은\u{7}채 "), "은채");
		assert_eq!(clean_name(&"가".repeat(50)).chars().count(), 40);
	}
}
