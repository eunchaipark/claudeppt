// 슬라이드 런타임 — deck:// 이 슬라이드 HTML 을 내줄 때 </body> 앞에 끼워 넣는다 (원본 파일에는 없다).
// 앱 화면(부모 창)과 postMessage 로만 말한다. 슬라이드 좌표는 늘 1:1 픽셀(보통 1280×720)이다 — 확대 · 축소는 부모가 한다.
//
// 목차
//   pathOf · label        요소 ↔ 자식 번호 길 (원본 HTML 에 되쓸 때 같은 요소를 찾는다)
//   편집                  두 번 눌러 글자 고치기 · 끌어 옮기기 · 방향키 · Delete
//   message               부모 창이 보낸 말 처리
//   굽기                  bake — 브라우저가 그린 그대로 PNG (PowerPoint 가 같게 못 그리는 것 · 비교 검사)
//   PPTX 좌표 뽑기        color · runsOf(글자 조각과 줄 바꿈 자리) · extract — 도형으로 같게 그릴 수 있으면 도형, 아니면 굽기
//
// 받는 말                         보내는 말
//   css                 CSS 만 다시 읽기       ready {w,h}
//   mode {mode}         view · pin · edit      hit {req, path, tag, text}
//   hit {req,x,y}       그 자리 요소 찾기       edit {path, html}         글자를 고쳤다
//   extract {req}       PPTX 용 좌표 뽑기      patch {path, style}       끌어 옮겼다 · 크기를 바꿨다
//   snapshot {req}      슬라이드 전체 굽기     snapshot {req, data}
//                                              remove {path}             지웠다
//                                              extracted {req, data}
//                                              wheel {dy} · key {key}    휠 · 쪽 넘김 키 (무대가 쪽을 넘긴다)
//                                              menu {x, y, path, tag, text}  우클릭 — 앱이 그 자리에 메뉴를 연다
(() => {
	const root = document.querySelector(".slide") || document.body;
	const post = (m) => parent.postMessage({ __deck: 1, ...m }, "*");
	const css = (el) => getComputedStyle(el);
	document.documentElement.style.overflow = "hidden";

	// 요소 → 슬라이드 뿌리부터의 자식 번호 길. 부모가 원본 HTML 을 DOMParser 로 읽어 같은 길로 찾아간다.
	const pathOf = (el) => {
		const p = [];
		for (let e = el; e && e !== root; e = e.parentElement) {
			if (!e.parentElement) return null;
			p.unshift([...e.parentElement.children].indexOf(e));
		}
		return p;
	};
	const atPath = (p) => p.reduce((e, i) => e?.children[i] ?? null, root);
	// 고친 요소를 다시 그린 뒤에도 고른 채로 — 원본에 되쓰면 앱이 이 쪽을 새로 읽어(핫 리로드) 고른 것 · 키보드 자리가 사라진다.
	// 그러면 Enter 로 마친 뒤 Enter · F2 로 이어 고치지 못한다. 되쓰기 직전에 길을 적어 두고, 다시 뜬 무대 쪽이 edit 모드를 받으면 되살린다.
	// 쪽 목록 미리보기는 view 모드를 받으므로 되살리지 않는다 (2026.11.25)
	const KEEP = "deck-keep:" + location.pathname;
	const keep = (el) => { try { sessionStorage.setItem(KEEP, JSON.stringify({ path: pathOf(el), at: Date.now() })); } catch {} };
	const label = (el) => {
		const t = (el.innerText || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
		return t.length > 60 ? t.slice(0, 60) + "…" : t;
	};

	// ── 편집 ── 글자를 고친다 · 끌어 옮긴다 · 방향키로 1px(Shift 10px) · Delete 로 지운다
	//   글 고치기 시작   두 번 누르기(누른 낱말이 골라진다) · 고른 요소를 한 번 더 누르기(누른 자리에 커서) · 고른 요소에서 Enter · F2(글 전체를 고른다)
	//   마치기 · 취소    Enter 또는 밖을 누르면 원본에 되쓴다 · Esc 는 고치기 전으로 · Shift+Enter 는 줄 바꿈(<br>)
	//   붙여 넣기        글자만 — 다른 문서의 서식(style · 글꼴 · 색)이 섞이면 PPTX 로 나갈 때 모양이 틀어진다
	// 2026.11.25 : 두 번 누르기만 있었고 Enter 가 <div> 를 끼워 넣고 Esc 도 저장했다 — 제목을 고치다 Enter 로 마치려 하면 구조가 깨졌다
	let mode = "view", sel = null, drag = null, edit = null, picked = 0;
	const style = document.createElement("style");
	style.textContent = `
		[data-deck-edit] .slide *:hover { outline: 1px solid rgba(229,72,45,.32); outline-offset: 1px; cursor: default }
		[data-deck-edit] [data-deck-sel] { outline: 1.5px solid #e5482d !important; outline-offset: 1px }
		[data-deck-edit] [contenteditable=true] { outline: 1.5px solid #e5482d !important; cursor: text }`;
	document.head.appendChild(style);
	const select = (el) => {
		if (sel) sel.removeAttribute("data-deck-sel");
		sel = el;
		if (sel) sel.setAttribute("data-deck-sel", "");
	};
	const movable = (el) => el && el !== root && ["absolute", "fixed"].includes(css(el).position);
	// 글을 고칠 수 있는 요소 — 글이 있고, 그림 · 표처럼 글 상자로 다루지 않는 것을 품지 않은 것
	const editable = (el) => el && el !== root && el !== document.body && !!(el.innerText || "").trim() && !el.querySelector("img, svg, table, video, canvas");

	/** 글 고치기를 시작한다. at 이 있으면 그 자리에 커서, all 이면 글 전체를 고른다. 둘 다 없으면 브라우저가 고른 그대로(두 번 누르기의 낱말) */
	const startEdit = (el, at, all) => {
		if (edit || !editable(el)) return;
		edit = { el, before: el.innerHTML, cancel: false };
		select(null);
		el.contentEditable = "true";
		el.focus();
		const s = getSelection();
		const r = at ? document.caretRangeFromPoint(at.x, at.y) : all ? document.createRange() : null;
		if (r) {
			if (all) r.selectNodeContents(el);
			s.removeAllRanges();
			s.addRange(r);
		}
		el.addEventListener("blur", finishEdit, { once: true });
	};
	const finishEdit = () => {
		if (!edit) return;
		const { el, before, cancel } = edit;
		edit = null;
		el.removeAttribute("contenteditable");
		if (cancel) el.innerHTML = before;
		else if (el.innerHTML !== before) { keep(el); post({ t: "edit", path: pathOf(el), html: el.innerHTML }); }
		// Enter · Esc 로 마쳤으면 그 요소를 고른 채로 둔다. 다른 요소를 눌러 마쳤으면 그 요소가 이미 골라져 있다 — 덮지 않는다
		if (!sel) select(el);
	};
	/** 글자만 끼운다 — 줄은 <br> 로 */
	const insertPlain = (text) => {
		const lines = text.replace(/\r\n?/g, "\n").split("\n");
		lines.forEach((l, i) => {
			if (i) document.execCommand("insertLineBreak");
			if (l) document.execCommand("insertText", false, l);
		});
	};
	addEventListener("paste", (e) => {
		if (!edit) return;
		e.preventDefault();
		insertPlain(e.clipboardData?.getData("text/plain") || "");
	});
	addEventListener("drop", (e) => {
		if (!edit) return;
		e.preventDefault();
		const t = e.dataTransfer?.getData("text/plain");
		if (!t) return;
		const r = document.caretRangeFromPoint(e.clientX, e.clientY);
		if (r) { getSelection().removeAllRanges(); getSelection().addRange(r); }
		insertPlain(t);
	});

	addEventListener("pointerdown", (e) => {
		if (mode !== "edit") return;
		const el = e.target.closest("[contenteditable=true]") ? null : e.target;
		if (!el || el === root || el === document.body) return select(null);
		// 고른 지 조금 지난 요소를 다시 누르면 글 고치기 — 두 번 누르기의 둘째 누름과 가르려고 시간을 본다
		const again = el === sel && e.button === 0 && Date.now() - picked > 450;
		if (el !== sel) picked = Date.now();
		select(el);
		if (again && editable(el) && !movable(el)) {
			startEdit(el, { x: e.clientX, y: e.clientY });
			return;
		}
		// 우클릭은 고르기만 한다 — 끌기를 시작하면 메뉴를 여는 동안 요소가 손에 붙는다
		if (movable(el) && e.button === 0) {
			drag = { el, x: e.clientX, y: e.clientY, l: parseFloat(css(el).left) || el.offsetLeft, t: parseFloat(css(el).top) || el.offsetTop, moved: false, again };
			e.preventDefault();
		}
	}, true);
	addEventListener("pointermove", (e) => {
		if (!drag) return;
		const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
		if (!drag.moved && Math.hypot(dx, dy) < 3) return;
		drag.moved = true;
		drag.el.style.left = Math.round(drag.l + dx) + "px";
		drag.el.style.top = Math.round(drag.t + dy) + "px";
	});
	addEventListener("pointerup", (e) => {
		if (drag?.moved) { keep(drag.el); post({ t: "patch", path: pathOf(drag.el), style: { left: drag.el.style.left, top: drag.el.style.top } }); }
		// 옮길 수 있는 요소는 누르면 끌기가 시작된다 — 끌지 않고 뗐고 이미 골라 둔 요소였으면 그때 글 고치기
		else if (drag && drag.again && editable(drag.el)) startEdit(drag.el, { x: e.clientX, y: e.clientY });
		drag = null;
	});
	addEventListener("dblclick", (e) => {
		if (mode !== "edit" || edit) return;
		// 그림 · 표를 품은 요소를 두 번 눌렀으면 그 안의 글 요소까지 내려가지 않는다 — 누른 요소가 글 상자일 때만
		startEdit(e.target);
	});
	// 휠 · 쪽 넘김 키는 앱으로 넘긴다 — 슬라이드 창이 받아 버리면 무대 위에서 휠을 굴리거나, 슬라이드를 한 번 누른 뒤 방향키를 눌러도 쪽이 안 넘어간다
	addEventListener("wheel", (e) => post({ t: "wheel", dy: e.deltaY }), { passive: true });
	// 우클릭도 앱으로 넘긴다 — 웹뷰 기본 메뉴(뒤로 · 새로 고침)는 슬라이드 창을 엉뚱한 곳으로 보낸다.
	// 글자를 고치는 중이면 기본 메뉴(붙여 넣기 · 맞춤법)를 그대로 쓴다
	addEventListener("contextmenu", (e) => {
		if (e.target.isContentEditable) return;
		e.preventDefault();
		const el = e.target.nodeType === 1 ? e.target : root;
		post({ t: "menu", x: e.clientX, y: e.clientY, path: pathOf(el), tag: el.tagName.toLowerCase(), text: el === root ? "" : label(el) });
	});
	addEventListener("keydown", (e) => {
		// 되돌리기 · 다시 하기는 앱이 한다 (손으로 고친 것을 파일째 되쓴다). 글자를 고치는 중이면 그 글의 되돌리기를 쓴다
		if (e.ctrlKey && !e.altKey && ["z", "y"].includes(e.key.toLowerCase()) && !document.activeElement?.isContentEditable) {
			// 아직 파일에 쓰지 않은 방향키 이동이 있으면 먼저 쓴다 — 안 그러면 되돌린 뒤에 늦게 쓰여 되돌림을 덮는다
			if (sel?.__nudge) { clearTimeout(sel.__nudge); sel.__nudge = null; post({ t: "patch", path: pathOf(sel), style: { left: sel.style.left, top: sel.style.top } }); }
			post({ t: e.key.toLowerCase() === "y" || e.shiftKey ? "redo" : "undo" });
			e.preventDefault();
			return;
		}
		// 고른 요소가 없으면(보기만 하는 중) 넘김 키는 쪽을 넘긴다 — 고르기 도구가 늘 켜져 있어도 방향키로 쪽을 넘길 수 있게
		if ((mode !== "edit" || !sel) && !document.activeElement?.isContentEditable && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End"].includes(e.key) && !e.ctrlKey && !e.altKey) {
			post({ t: "key", key: e.key });
			e.preventDefault();
			return;
		}
		if (mode !== "edit") return;
		if (edit) {
			if (e.key === "Escape") { edit.cancel = true; edit.el.blur(); e.preventDefault(); }
			else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { edit.el.blur(); e.preventDefault(); }
			else if (e.key === "Enter" && e.shiftKey && !e.isComposing) { document.execCommand("insertLineBreak"); e.preventDefault(); }
			return;
		}
		if (!sel) return;
		if ((e.key === "Enter" || e.key === "F2") && editable(sel)) {
			startEdit(sel, null, true);
			e.preventDefault();
		} else if (e.key === "Delete" || e.key === "Backspace") {
			post({ t: "remove", path: pathOf(sel) });
			select(null);
		} else if (e.key.startsWith("Arrow") && movable(sel)) {
			const d = e.shiftKey ? 10 : 1, s = css(sel);
			const l = parseFloat(s.left) || 0, t = parseFloat(s.top) || 0;
			if (e.key === "ArrowLeft") sel.style.left = l - d + "px";
			if (e.key === "ArrowRight") sel.style.left = l + d + "px";
			if (e.key === "ArrowUp") sel.style.top = t - d + "px";
			if (e.key === "ArrowDown") sel.style.top = t + d + "px";
			clearTimeout(sel.__nudge);
			const el = sel;
			sel.__nudge = setTimeout(() => { keep(el); post({ t: "patch", path: pathOf(el), style: { left: el.style.left, top: el.style.top } }); }, 400);
			e.preventDefault();
		} else if (e.key === "Escape") select(null);
	});

	addEventListener("message", async (e) => {
		const m = e.data;
		if (!m || !m.__deck) return;
		if (m.t === "css") {
			document.querySelectorAll("link[rel=stylesheet]").forEach((l) => { l.href = l.href.split("?")[0] + "?t=" + Date.now(); });
		} else if (m.t === "mode") {
			mode = m.mode;
			document.documentElement.toggleAttribute("data-deck-edit", mode === "edit");
			if (mode !== "edit") select(null);
			else {
				let k = null;
				try { k = JSON.parse(sessionStorage.getItem(KEEP) || "null"); sessionStorage.removeItem(KEEP); } catch {}
				const el = k && Date.now() - k.at < 5000 && k.path ? atPath(k.path) : null;
				if (el && el !== root) { select(el); picked = Date.now(); window.focus(); }
			}
		} else if (m.t === "hit") {
			const el = document.elementFromPoint(m.x, m.y) || root;
			post({ t: "hit", req: m.req, path: pathOf(el), tag: el.tagName.toLowerCase(), text: el === root ? "" : label(el), cls: el.className && typeof el.className === "string" ? el.className : "" });
		} else if (m.t === "snapshot") {
			// 비교 검사용 — 슬라이드 전체를 1:1 로 굽는다
			try {
				await within(document.fonts.ready, 3000);
				const S = root.getBoundingClientRect();
				post({ t: "snapshot", req: m.req, data: await bake(root, { x: 0, y: 0, w: S.width, h: S.height }, true, m.scale || 1) });
			} catch (err) { post({ t: "snapshot", req: m.req, error: String(err) }); }
		} else if (m.t === "extract") {
			try { post({ t: "extracted", req: m.req, data: await extract() }); }
			catch (err) { post({ t: "extracted", req: m.req, error: String(err) }); }
		}
	});

	// ── PPTX 좌표 뽑기 ──
	// 브라우저가 실제로 그린 자리를 잰다 — PPT 쪽에서 배치를 다시 계산하지 않아야 웹과 PPT 가 따로 놀지 않는다.
	// 상자(바탕 · 테두리)는 도형, 글자 묶음은 글상자, 표는 표, 그림 · SVG 는 그림(PNG)으로 넘긴다.
	const INLINE = new Set(["SPAN", "B", "STRONG", "I", "EM", "U", "A", "BR", "SUP", "SUB", "CODE", "SMALL", "MARK", "S", "DEL", "INS", "LABEL", "ABBR", "Q"]);
	// rgb() 밖의 색(color-mix 가 낳는 color(srgb …) · oklch …)은 1px 캔버스에 칠해 픽셀로 읽는다
	const px = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	px.canvas.width = px.canvas.height = 1;
	const color = (c) => {
		if (!c || c === "transparent" || c === "none") return null;
		const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\)/.exec(c);
		if (!m) {
			px.clearRect(0, 0, 1, 1);
			px.fillStyle = "#000"; px.fillStyle = c;
			px.fillRect(0, 0, 1, 1);
			const [r, g, b, a] = px.getImageData(0, 0, 1, 1).data;
			if (a === 0) return null;
			return { hex: [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase(), alpha: Math.round((a / 255) * 100) / 100 };
		}
		let a = m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4];
		if (a === 0) return null;
		return { hex: [m[1], m[2], m[3]].map((v) => Math.round(+v).toString(16).padStart(2, "0")).join("").toUpperCase(), alpha: a };
	};
	const visible = (el) => {
		for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
			const s = css(e);
			if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
		}
		return true;
	};
	const opacityOf = (el) => { let o = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) o *= +css(e).opacity || 1; return o; };
	// 글꼴 목록 전체를 넘긴다 — 앞 글꼴이 이 PC 에 없으면 브라우저는 다음 글꼴로 그린다. 내보내기도 같은 차례로 고른다
	const fontOf = (s) => s.fontFamily.split(",").map((f) => f.replace(/["']/g, "").trim()).filter(Boolean).join("|");
	const isTextBlock = (el) => {
		let text = false;
		for (const n of el.childNodes) {
			if (n.nodeType === 3) { if (n.nodeValue.trim()) text = true; }
			else if (n.nodeType === 1) { if (!INLINE.has(n.tagName) || css(n).display.includes("block") || css(n).display === "flex") return false; }
		}
		return text || (el.innerText || "").trim() !== "";
	};
	// 숨은 iframe 에서는 글꼴 · 그림 준비가 끝없이 미뤄질 때가 있다 — 기다림마다 한도를 둔다
	const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
	const hasInlineOnly = (el) => [...el.children].every((c) => INLINE.has(c.tagName) && !css(c).display.includes("block"));

	// ── 굽기 — 요소를 브라우저가 그린 그대로 PNG 로 ──
	// PowerPoint 가 같은 모양으로 그릴 수 없는 것(그라데이션 · 그림자 · 변형 · 필터 · ::before/::after · 그림 · SVG)은
	// 계산된 서식을 모두 박은 복제본을 SVG foreignObject 에 넣어 같은 엔진으로 그린다. 그림 · 글꼴은 data: 로 바꿔 넣는다
	// (그렇지 않으면 그림이 비거나 캔버스가 막힌다). deep=false 면 자식 없이 그 요소의 바탕 · 테두리 · 그림자만 굽는다.
	const dataCache = new Map();
	const toData = (url) => {
		if (!url || url.startsWith("data:")) return Promise.resolve(url);
		if (!dataCache.has(url)) {
			dataCache.set(url, fetch(url).then((r) => r.blob()).then((b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); })).catch(() => url));
		}
		return dataCache.get(url);
	};
	const URLS = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
	const inlineUrls = async (v, base = location.href) => {
		let out = v;
		for (const m of [...v.matchAll(URLS)]) {
			// url(#이름) 은 같은 문서 안 참조(화살촉 marker · 그라데이션 · 자르기)다 — 받아 넣으면 이 쪽 HTML 전체가 되어 구운 그림에서 화살촉이 사라졌다 (2026.11.23)
			if (m[1].startsWith("#")) continue;
			out = out.replace(m[0], `url("${await toData(new URL(m[1], base).href)}")`);
		}
		return out;
	};
	// 글꼴 — 문서의 @font-face 를 가족 이름별로 모아 두고, 굽는 요소 안 글자가 쓰는 가족만 넣는다. data: 로 바꾸는 것은 처음 쓸 때 한 번.
	// 2026.11.25 : 전에는 굽기마다 모든 글꼴(덱에 든 Pretendard 만 2MB 넘음)을 통째로 넣어, 글자 없는 그림 · 도형 · 바탕을 구울 때도 SVG 가 몇 MB 였다
	const famKey = (f) => f.trim().replace(/^["']|["']$/g, "").toLowerCase();
	let faceList = null;
	const faces = () => (faceList ||= (() => {
		const out = [];
		for (const sh of document.styleSheets) {
			let rules;
			try { rules = sh.cssRules; } catch { continue; }
			for (const r of rules) if (r instanceof CSSFontFaceRule) out.push({ fam: famKey(r.style.getPropertyValue("font-family")), src: r.cssText, base: sh.href || location.href, css: null });
		}
		return out;
	})());
	/** 구운 그림에 그려질 글자가 쓰는 가족 — 얕게 구우면 자식(글자)은 빠지고 ::before · ::after 만 남는다. 글자가 없으면 비어 있다 */
	const usedFamilies = (el, deep) => {
		const fams = new Set();
		const pseudo = (e) => ["::before", "::after"].some((w) => { const c = getComputedStyle(e, w).content; return !!c && c !== "none" && c !== "normal" && !!unquote(c); });
		for (const e of deep ? [el, ...el.querySelectorAll("*")] : [el]) {
			const text = deep && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
			if (text || pseudo(e)) for (const f of css(e).fontFamily.split(",")) fams.add(famKey(f));
		}
		return fams;
	};
	const fontCss = async (fams) => {
		const out = [];
		for (const f of faces()) {
			if (!fams.has(f.fam)) continue;
			f.css ||= inlineUrls(f.src, f.base);
			out.push(await f.css);
		}
		return out.join("\n");
	};
	// 논리 속성(inset-inline-start · margin-block-end · inline-size …)은 옮기지 않는다 — 계산 값에는 물리 속성(left · margin-bottom · width)과
	// 둘 다 들어 있고, 뒤에 오는 논리 속성이 나중에 바꾼 left · width 를 이겨 복제본이 슬라이드 (0,0) 으로 간다.
	// (2026.11.17 : 다른 요소 안에 놓인 그림 · SVG 가 빈 그림으로 구워진 까닭이었다)
	const LOGICAL = /^(inset|inline-size|block-size|(min|max)-(inline|block)-size)|-(inline|block)(-|$)/;
	const styleText = async (cs) => {
		let t = "";
		for (let i = 0; i < cs.length; i++) {
			const k = cs[i];
			if (LOGICAL.test(k)) continue;
			let v = cs.getPropertyValue(k);
			if (v.includes("url(")) v = await inlineUrls(v);
			t += `${k}:${v};`;
		}
		return t;
	};
	const unquote = (c) => (/^["'].*["']$/.test(c) ? c.slice(1, -1).replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, "$1") : "");
	async function styledClone(el, deep) {
		const clone = el.cloneNode(deep);
		const srcs = deep ? [el, ...el.querySelectorAll("*")] : [el];
		const dsts = deep ? [clone, ...clone.querySelectorAll("*")] : [clone];
		for (let i = 0; i < srcs.length; i++) {
			const s = srcs[i], d = dsts[i];
			d.removeAttribute("data-deck-sel");
			d.removeAttribute("contenteditable");
			d.setAttribute("style", await styleText(css(s)));
			if (s.tagName === "IMG") d.setAttribute("src", await toData(s.currentSrc || s.src));
			if (s.tagName === "image" || s.tagName === "use") {
				const h = s.getAttribute("href") || s.getAttribute("xlink:href");
				if (h && !h.startsWith("#")) d.setAttribute("href", await toData(new URL(h, location.href).href));
			}
			if (s.tagName === "CANVAS") {
				const im = document.createElement("img");
				im.src = s.toDataURL();
				im.setAttribute("style", d.getAttribute("style"));
				d.replaceWith(im);
				continue;
			}
			for (const which of ["::before", "::after"]) {
				const ps = getComputedStyle(s, which);
				if (!ps.content || ps.content === "none" || ps.content === "normal") continue;
				const sp = document.createElement("span");
				sp.setAttribute("style", await styleText(ps));
				sp.textContent = unquote(ps.content);
				which === "::before" ? d.prepend(sp) : d.append(sp);
			}
		}
		return clone;
	}
	/** 요소 하나를 굽는다. box 는 슬라이드 좌표로 그릴 영역(그림자가 넘치면 넓힌다). */
	async function bake(el, box, deep, scale = 2) {
		const S = root.getBoundingClientRect();
		// 변형 전 자리 — 복제본을 같은 자리에 두면 변형 · 그림자가 원래대로 그려진다
		const old = el.style.transform;
		const tf = css(el).transform;
		if (tf !== "none") el.style.transform = "none";
		const L = el.getBoundingClientRect();
		if (tf !== "none") el.style.transform = old;
		const clone = await styledClone(el, deep);
		if (el !== root) {
			clone.style.position = "absolute";
			clone.style.left = L.left - S.left + "px";
			clone.style.top = L.top - S.top + "px";
			clone.style.margin = "0";
		}
		clone.style.boxSizing = "border-box";
		clone.style.width = L.width + "px";
		clone.style.height = L.height + "px";
		const wrap = document.createElement("div");
		wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
		wrap.setAttribute("style", `position:relative;width:${S.width}px;height:${S.height}px;overflow:hidden;margin:0;background:transparent`);
		const st = document.createElement("style");
		const fams = usedFamilies(el, deep);
		st.textContent = fams.size ? await fontCss(fams) : "";
		wrap.append(st, clone);
		const xml = new XMLSerializer().serializeToString(wrap);
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}"><foreignObject x="0" y="0" width="${S.width}" height="${S.height}">${xml}</foreignObject></svg>`;
		const img = new Image();
		img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
		await within(img.decode(), 8000);
		// 그리지 못한 그림을 빈칸으로 넘기지 않는다 — 빈 그림은 PPT 에서 「빠진 요소」가 된다
		if (!img.complete || !img.naturalWidth) throw new Error("bake: decode failed");
		const c = document.createElement("canvas");
		c.width = Math.max(1, Math.round(box.w * scale));
		c.height = Math.max(1, Math.round(box.h * scale));
		c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
		return c.toDataURL("image/png");
	}
	/** 그림자 · 외곽선 · 필터가 상자 밖으로 그리는 여유 */
	const overflowOf = (s) => {
		let pad = 0;
		if (s.boxShadow !== "none") {
			for (const part of s.boxShadow.split(/,(?![^(]*\))/)) {
				if (part.includes("inset")) continue;
				const n = (part.replace(/rgba?\([^)]*\)|color\([^)]*\)/g, "").match(/-?[\d.]+px/g) || []).map(parseFloat);
				pad = Math.max(pad, Math.abs(n[0] || 0) + Math.abs(n[1] || 0) + (n[2] || 0) * 1.5 + Math.max(0, n[3] || 0));
			}
		}
		if (s.outlineStyle !== "none") pad = Math.max(pad, (parseFloat(s.outlineWidth) || 0) + Math.abs(parseFloat(s.outlineOffset) || 0));
		if (s.filter !== "none") pad = Math.max(pad, 40);
		return Math.ceil(pad);
	};
	const pseudoOn = (el, w) => { const c = getComputedStyle(el, w).content; return !!c && c !== "none" && c !== "normal"; };
	/** 자식까지 통째로 구워야 하는가 — 그 요소의 효과가 자식의 모양까지 바꾼다 */
	const needsDeep = (el, s) =>
		["IMG", "CANVAS", "VIDEO", "PICTURE", "svg"].includes(el.tagName) ||
		s.transform !== "none" || s.filter !== "none" || (s.backdropFilter && s.backdropFilter !== "none") || s.mixBlendMode !== "normal" ||
		s.clipPath !== "none" || (s.maskImage && s.maskImage !== "none") || (s.webkitMaskImage && s.webkitMaskImage !== "none") ||
		s.textShadow !== "none" || s.writingMode !== "horizontal-tb" || s.backgroundClip === "text" || s.webkitBackgroundClip === "text" ||
		(s.display === "list-item" && s.listStyleType !== "none");
	/** 바깥 그림자 하나(안쪽 · 퍼짐 없음) — PowerPoint 도형 그림자로 그대로 옮긴다. 그 밖의 그림자는 null (상자를 굽는다).
	 *  2026.11.24 : 가져온 PPTX 의 도형 그림자를 box-shadow 로 그리게 되어, 굽지 않고 도형 그림자로 내보낸다 */
	const simpleShadow = (s) => {
		if (s.boxShadow === "none" || s.boxShadow.split(/,(?![^(]*\))/).length > 1 || s.boxShadow.includes("inset")) return null;
		const c = color((/rgba?\([^)]*\)|color\([^)]*\)/.exec(s.boxShadow) || [])[0]);
		const n = (s.boxShadow.replace(/rgba?\([^)]*\)|color\([^)]*\)/g, "").match(/-?[\d.]+px/g) || []).map(parseFloat);
		if (!c || n.length < 2 || (n[3] || 0) !== 0) return null;
		return { x: n[0], y: n[1], blur: n[2] || 0, ...c };
	};
	/** 그 요소의 바탕 · 테두리만 구우면 되는가 — PowerPoint 도형으로 같은 모양이 안 나온다 */
	const needsShallow = (el, s) => {
		if (s.backgroundImage !== "none" || (s.boxShadow !== "none" && !simpleShadow(s)) || (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0)) return true;
		if (pseudoOn(el, "::before") || pseudoOn(el, "::after")) return true;
		const rad = [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius];
		if (new Set(rad).size > 1 || rad[0].trim().includes(" ")) return true;
		const sides = ["Top", "Right", "Bottom", "Left"].map((k) => [parseFloat(s["border" + k + "Width"]) || 0, s["border" + k + "Style"], s["border" + k + "Color"]]).filter(([w, st]) => w > 0 && st !== "none");
		if (sides.some(([, st]) => !["solid", "dashed", "dotted"].includes(st))) return true;
		// 네 변이 다 있는데 굵기 · 모양 · 색이 다르거나, 일부 변만 있으면서 모서리가 둥글면 도형 · 선으로 같게 못 그린다
		if (sides.length === 4 && new Set(sides.map((x) => x.join("|"))).size > 1) return true;
		if (sides.length > 0 && sides.length < 4 && parseFloat(rad[0]) > 0) return true;
		return false;
	};

	// 첫 줄 기준선 — 첫 글자의 글자 상자 위끝 + 글꼴 위 높이(ascent). DOM 을 건드리지 않고 잰다
	// (flex 상자에 재는 요소를 넣으면 배치가 바뀐다). 줄 높이가 normal 이면 글꼴의 위 · 아래 높이 합이다.
	const metric = document.createElement("canvas").getContext("2d");
	const fontMetrics = (s) => {
		metric.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
		const m = metric.measureText("가Ag");
		return { asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent };
	};
	function firstBaseline(el) {
		const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let n; (n = w.nextNode());) {
			const i = n.nodeValue.search(/\S/);
			if (i < 0) continue;
			const r = document.createRange();
			r.setStart(n, i); r.setEnd(n, i + 1);
			const rect = r.getClientRects()[0];
			if (!rect) continue;
			const s = css(n.parentElement);
			return { y: rect.top + fontMetrics(s).asc, size: parseFloat(s.fontSize), s };
		}
		return null;
	}

	// 글자 조각. 브라우저가 실제로 줄을 바꾼 자리에서 조각을 나누고 soft 를 단다 — PPT 에서 같은 자리에 줄 바꿈(<a:br>)을 넣어
	// 한국어 낱말 끊기(keep-all)와 줄 수가 웹과 같게 된다. PowerPoint 는 한국어를 글자 단위로 끊는다.
	function runsOf(el) {
		const runs = [];
		const line = { top: null };
		const range = document.createRange();
		const topAt = (n, i) => { range.setStart(n, i); range.setEnd(n, i + 1); const r = range.getClientRects()[0]; return r ? Math.round(r.top) : null; };
		const walk = (node) => {
			for (const n of node.childNodes) {
				if (n.nodeType === 3) {
					const s = css(n.parentElement), c = color(s.color);
					const tt = s.textTransform;
					const raw = tt === "uppercase" ? n.nodeValue.toUpperCase() : tt === "lowercase" ? n.nodeValue.toLowerCase() : n.nodeValue;
					if (!raw.trim() && !runs.length) continue;
					const style = {
						size: parseFloat(s.fontSize), weight: +s.fontWeight || 400, bold: +s.fontWeight >= 600, italic: s.fontStyle === "italic",
						spacing: parseFloat(s.letterSpacing) || 0,
						underline: s.textDecorationLine.includes("underline"), strike: s.textDecorationLine.includes("line-through"),
						color: c ? c.hex : "000000", alpha: c ? c.alpha : 1, font: fontOf(s),
						// 글 조각(인라인)의 바탕색 = PowerPoint 의 글자 강조 표시. 문단 · 상자 바탕은 상자가 따로 그린다
						highlight: s.display.startsWith("inline") && n.parentElement !== el ? color(s.backgroundColor)?.hex || null : null,
					};
					let start = 0, soft = false;
					for (let i = 0; i < raw.length; i++) {
						if (/\s/.test(raw[i])) continue;
						const top = topAt(n, i);
						if (top == null) continue;
						if (line.top != null && top > line.top + 2) {
							if (i > start) runs.push({ ...style, text: raw.slice(start, i).replace(/\s+/g, " "), soft });
							else if (!runs.length || runs[runs.length - 1].br) { /* 앞에 조각이 없으면 줄 바꿈만 */ }
							start = i;
							soft = true;
						}
						line.top = top;
					}
					runs.push({ ...style, text: raw.slice(start).replace(/\s+/g, " "), soft });
				} else if (n.nodeType === 1) {
					if (n.tagName === "BR") { runs.push({ text: "\n", br: true }); line.top = null; }
					else if (visible(n)) walk(n);
				}
			}
		};
		walk(el);
		// 줄 끝 · 줄 머리 빈칸은 덜어 낸다 — 들여쓰기 줄바꿈과 끊긴 자리의 빈칸이 PPT 에서 빈칸으로 남는다
		runs.forEach((r, i) => {
			if (r.br) return;
			const next = runs[i + 1];
			if (i === 0 || r.soft || runs[i - 1]?.br) r.text = r.text.replace(/^\s+/, "");
			if (!next || next.soft || next.br) r.text = r.text.replace(/\s+$/, "");
		});
		return runs.filter((r) => r.br || r.text !== "");
	}

	async function extract() {
		await within(document.fonts.ready, 3000);
		const S = root.getBoundingClientRect();
		const R = (r) => ({ x: r.left - S.left, y: r.top - S.top, w: r.width, h: r.height });
		const items = [];
		const fails = [];
		const rs = css(root);
		const bg = color(rs.backgroundColor) || color(css(document.body).backgroundColor);
		// 슬라이드 바탕에 그림 · 그라데이션 · 장식이 있으면 바탕을 구워 맨 아래에 깐다
		if (rs.backgroundImage !== "none" || pseudoOn(root, "::before") || pseudoOn(root, "::after")) {
			try { items.push({ type: "image", x: 0, y: 0, w: S.width, h: S.height, data: await bake(root, { x: 0, y: 0, w: S.width, h: S.height }, false), baked: "background", tag: "section" }); } catch {}
		}
		// 조상이 넘친 부분을 자르면(overflow) 굽는 상자도 그만큼 줄인다 — 잘라 쓴 그림(PPT 의 그림 자르기)이 PPTX 에서 원본 크기로 튀어나왔다 (2026.11.18)
		const clipped = (el, box) => {
			let x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
			for (let a = el.parentElement; a && a !== root && a !== document.body; a = a.parentElement) {
				const o = css(a);
				if (o.overflowX === "visible" && o.overflowY === "visible") continue;
				const c = R(a.getBoundingClientRect());
				if (o.overflowX !== "visible") { x0 = Math.max(x0, c.x); x1 = Math.min(x1, c.x + c.w); }
				if (o.overflowY !== "visible") { y0 = Math.max(y0, c.y); y1 = Math.min(y1, c.y + c.h); }
			}
			return x1 - x0 < 0.5 || y1 - y0 < 0.5 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
		};
		// 묶음 — 도형마다 그것을 낳은 요소와 그 조상 요소의 번호(g)를 단다. 내보낼 때 같은 요소에서 나온 도형 둘 이상을
		// PowerPoint 그룹으로 묶는다 (exportPptx.ts groupSlides). 카드 하나가 상자 · 제목 · 본문으로 흩어지면 옮길 때 하나씩 끌어야 했다
		const groups = {};
		let gid = 0;
		const visit = async (el, chain) => {
			for (const ch of el.children) {
				if (!(ch instanceof Element) || ch.tagName === "SCRIPT" || ch.tagName === "STYLE" || !visible(ch)) continue;
				const me = [...chain, ++gid];
				// 그룹 이름 — PowerPoint 「선택 창」에서 알아보게 이름표 · 첫 줄 글 · class 순으로 고른다 (div 만으로는 어느 묶음인지 모른다)
				const line = (ch.innerText || "").trim().split(/\r?\n/)[0].trim();
				groups[gid] = ch.dataset?.name || ch.getAttribute("aria-label") || ch.id || (line && (line.length > 24 ? line.slice(0, 24) + "…" : line)) || (typeof ch.className === "string" && ch.className.trim().split(/\s+/)[0]) || ch.tagName.toLowerCase();
				const start = items.length;
				await one(ch, me);
				// 자손이 먼저 자기 번호를 달았으므로 아직 비어 있는 것이 이 요소가 낳은 도형이다
				for (let k = start; k < items.length; k++) if (!items[k].g) items[k].g = me;
			}
		};
		const one = async (ch, me) => {
			const s = css(ch), r = R(ch.getBoundingClientRect()), op = opacityOf(ch);
			if (r.w < 0.5 || r.h < 0.5) return;
			// 통째로 굽기 — 그 요소와 자식이 한 장의 그림이 된다
			if (needsDeep(ch, s)) {
				const pad = overflowOf(s), box = clipped(ch, { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 });
				if (!box) return;
				try { items.push({ type: "image", ...box, data: await bake(ch, box, true), alt: ch.getAttribute("alt") || "", baked: "whole", tag: ch.tagName.toLowerCase() }); } catch (e) { fails.push(`${ch.tagName} ${String(e)}`); }
				return;
			}
			// 바탕 · 테두리만 굽기 — 글자 · 자식은 그 위에 그대로 편집할 수 있게 남는다
			const shallow = needsShallow(ch, s);
			if (shallow) {
				const pad = overflowOf(s), box = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
				try { items.push({ type: "image", ...box, data: await bake(ch, box, false), baked: "background", tag: ch.tagName.toLowerCase() }); } catch (e) { fails.push(`${ch.tagName} ${String(e)}`); }
			}
			// 상자
			const fill = color(s.backgroundColor);
			const bw = parseFloat(s.borderTopWidth) || 0, bc = color(s.borderTopColor);
			const sides = ["Top", "Right", "Bottom", "Left"].map((k) => (parseFloat(s["border" + k + "Width"]) || 0) > 0 && s["border" + k + "Style"] !== "none");
			const full = sides.every(Boolean);
			if (!shallow && (fill || (full && bc && bw))) {
				items.push({ type: "box", ...r, fill: fill ? { ...fill, alpha: fill.alpha * op } : null, line: full && bc && bw ? { ...bc, w: bw, dash: s.borderTopStyle } : null, radius: parseFloat(s.borderTopLeftRadius) || 0, round: s.borderTopLeftRadius.includes("%") && parseFloat(s.borderTopLeftRadius) >= 50, shadow: simpleShadow(s) });
			}
			// 한 변만 그은 선 (구분선 · 밑줄 강조)
			if (!shallow && !full) {
				["Top", "Right", "Bottom", "Left"].forEach((k, i) => {
					if (!sides[i]) return;
					const w = parseFloat(s["border" + k + "Width"]), c = color(s["border" + k + "Color"]);
					if (!c) return;
					const L = { Top: [r.x, r.y + w / 2, r.x + r.w, r.y + w / 2], Bottom: [r.x, r.y + r.h - w / 2, r.x + r.w, r.y + r.h - w / 2], Left: [r.x + w / 2, r.y, r.x + w / 2, r.y + r.h], Right: [r.x + r.w - w / 2, r.y, r.x + r.w - w / 2, r.y + r.h] }[k];
					items.push({ type: "line", x1: L[0], y1: L[1], x2: L[2], y2: L[3], color: c.hex, w, dash: s["border" + k + "Style"] });
				});
			}
			// 표
			if (ch.tagName === "TABLE") {
				const rows = [...ch.rows].map((tr) => [...tr.cells].map((td) => {
					const cs = css(td), c = color(cs.color), b = color(cs.backgroundColor) || color(css(tr).backgroundColor);
					// 칸 글자는 안쪽 span 마다 서식이 달라 조각(run)으로 넘긴다. 문단(p · div)이 나뉘면 줄을 바꾼다
					const runs = [];
					const blocks = [...td.querySelectorAll("p, div, li")].filter((e) => !e.querySelector("p, div, li") && (e.innerText || "").trim());
					if (blocks.length) blocks.forEach((bl, k) => { if (k) runs.push({ text: "\n", br: true }); runs.push(...runsOf(bl)); });
					else runs.push(...runsOf(td));
					const va = { top: "top", bottom: "bottom" }[cs.verticalAlign] || "middle";
					const pa = blocks[0] ? css(blocks[0]).textAlign : cs.textAlign;
					return { runs, text: td.innerText.trim(), size: parseFloat(cs.fontSize), bold: +cs.fontWeight >= 600, color: c ? c.hex : "000000", fill: b ? b.hex : null, align: pa, valign: va, font: fontOf(cs), colspan: td.colSpan, rowspan: td.rowSpan, border: color(cs.borderBottomColor)?.hex || null, bw: parseFloat(cs.borderBottomWidth) || 0, pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat) };
				}));
				// 열 너비는 모든 칸의 좌우 경계에서 구한다 — 첫 행에 합친 칸(colspan)이 있으면 첫 행 칸 수가 열 수보다 적어 열이 통째로 밀린다 (2026.11.18)
				const edges = [...new Set([...ch.rows].flatMap((tr) => [...tr.cells].flatMap((td) => { const b = td.getBoundingClientRect(); return [Math.round(b.left * 2) / 2, Math.round(b.right * 2) / 2]; })))].sort((x, y) => x - y)
					.filter((x, i, a) => i === 0 || x - a[i - 1] > 2);
				const colW = edges.slice(1).map((x, i) => x - edges[i]);
				const rowH = [...ch.rows].map((tr) => tr.getBoundingClientRect().height);
				items.push({ type: "table", ...r, rows, colW, rowH });
				return;
			}
			// 글자
			if (isTextBlock(ch) && hasInlineOnly(ch)) {
				const pl = parseFloat(s.paddingLeft) + (parseFloat(s.borderLeftWidth) || 0), pr = parseFloat(s.paddingRight) + (parseFloat(s.borderRightWidth) || 0);
				const pt = parseFloat(s.paddingTop) + (parseFloat(s.borderTopWidth) || 0), pb = parseFloat(s.paddingBottom) + (parseFloat(s.borderBottomWidth) || 0);
				const runs = runsOf(ch);
				if (runs.length) {
					const flex = s.display.includes("flex") || s.display.includes("grid");
					const valign = flex ? ({ center: "middle", "flex-end": "bottom", end: "bottom" }[s.alignItems] || "top") : s.verticalAlign === "middle" ? "middle" : "top";
					let align = s.textAlign;
					if (flex && (s.justifyContent === "center")) align = "center";
					if (flex && ["flex-end", "end", "right"].includes(s.justifyContent)) align = "right";
					// 줄 높이는 늘 px 로 넘긴다 — normal 을 PowerPoint 기본 줄 간격에 맡기면 글꼴마다 어긋난다
					const fb = firstBaseline(ch);
					const lhRaw = parseFloat(s.lineHeight);
					const fm = fontMetrics(fb ? fb.s : s);
					const lh = isNaN(lhRaw) ? fm.asc + fm.desc : lhRaw;
					const top = r.y + pt;
					items.push({ type: "text", x: r.x + pl, y: top, w: r.w - pl - pr, h: r.h - pt - pb, runs, align: align === "start" ? "left" : align === "end" ? "right" : align, valign, lineHeight: lh, baseline: fb ? fb.y - S.top - top : null, size0: fb ? fb.size : parseFloat(s.fontSize), alpha: op });
				}
				return;
			}
			// 블록 자식과 섞인 맨 글자 — 글자 조각마다 따로
			for (const n of ch.childNodes) {
				if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
				const range = document.createRange(); range.selectNodeContents(n);
				const rr = R(range.getBoundingClientRect()), c = color(s.color);
				items.push({ type: "text", ...rr, runs: [{ text: n.nodeValue.trim(), size: parseFloat(s.fontSize), bold: +s.fontWeight >= 600, italic: s.fontStyle === "italic", color: c ? c.hex : "000000", font: fontOf(s) }], align: "left", valign: "top" });
			}
			await visit(ch, me);
		};
		await visit(root, []);
		return { w: S.width, h: S.height, background: bg, items, fails, groups };
	}

	// 시험 도구(tools/cdp.mjs)가 슬라이드 안에서 굽기 · 뽑기를 바로 부를 수 있게
	window.__rt = { bake, extract, styledClone };
	post({ t: "ready", w: root.getBoundingClientRect().width, h: root.getBoundingClientRect().height });
})();
