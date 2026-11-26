// 슬라이드 런타임 — deck:// 이 슬라이드 HTML 을 내줄 때 </body> 앞에 끼워 넣는다 (원본 파일에는 없다).
// 앱 화면(부모 창)과 postMessage 로만 말한다. 슬라이드 좌표는 늘 1:1 픽셀(보통 1280×720)이다 — 확대 · 축소는 부모가 한다.
//
// 목차
//   pathOf · label        요소 ↔ 자식 번호 길 (원본 HTML 에 되쓸 때 같은 요소를 찾는다)
//   편집                  고르기 · 글자 고치기 · 옮기기 · 크기 손잡이 · 넣기 · 순서 · 맞춤 · 복제 · 복사 · 서식 (서식 띠 명령 cmd)
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
//   audit {req}         감사용 서식 재기       audited {req, data}
//                                              remove {path}             지웠다
//                                              extracted {req, data}
//                                              wheel {dy} · key {key}    휠 · 쪽 넘김 키 (무대가 쪽을 넘긴다)
//                                              menu {x, y, path, tag, text}  우클릭 — 앱이 그 자리에 메뉴를 연다
//   cmd {cmd, v}        서식 띠 명령           sel {info}                고른 것의 서식 (없으면 null)
//                                              placing {kind}            넣기 중인 것 (끝나면 null)
//                                              append {html} · after {path, html} · order {path, to}  넣었다 · 복제했다 · 순서를 바꿨다
//                                              copy {html} · pasteReq    복사 · 붙여 넣기 (앱이 복사한 요소를 들고 있다)
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

	// ── 편집 ── 서식 띠(앱 Ribbon.tsx)와 함께 PowerPoint 의 「홈 · 삽입」 도구 노릇을 한다
	//   고르기          상자(절대 위치 요소) 안을 눌러도 처음에는 상자를 고른다. 고른 상자를 다시 누르면 누른 자리 글 고치기 · 글이 없는 자리면 그 안의 요소 고르기
	//   글 고치기       두 번 누르기(누른 낱말이 골라진다) · 고른 상자를 한 번 더 누르기(누른 자리에 커서) · 고른 요소에서 Enter · F2(글 전체를 고른다)
	//   마치기 · 취소   Enter 또는 밖을 누르면 원본에 되쓴다 · Esc 는 고치기 전으로 · Shift+Enter 는 줄 바꿈(<br>)
	//   붙여 넣기       글자만 — 다른 문서의 서식(style · 글꼴 · 색)이 섞이면 PPTX 로 나갈 때 모양이 틀어진다
	//   옮기기 · 크기   끌기 · 방향키 1px(Shift 10px) · 손잡이 8개(모서리 + Shift 는 비율 지킴, 그림은 늘 지킴)
	//   넣기            서식 띠가 place 를 보내면 끌어서 글상자 · 도형 · 선을 그린다(누르기만 하면 기본 크기). 그림은 쪽 가운데에 바로
	//   요소            Delete 지우기 · Ctrl+D 복제 · Ctrl+C · Ctrl+V 복사 · 붙여 넣기(다른 쪽에도) · Ctrl+B · I · U
	// 2026.11.25 : 두 번 누르기만 있었고 Enter 가 <div> 를 끼워 넣고 Esc 도 저장했다 — 제목을 고치다 Enter 로 마치려 하면 구조가 깨졌다
	// 2026.11.25 : 서식 띠 · 넣기 · 손잡이 · 복제 · 복사를 더했다. 상자를 먼저 고르게 바꿨다 — 누른 글 조각만 골라져 도형 · 카드를 끌 수 없었다
	let mode = "view", sel = null, drag = null, edit = null, picked = 0, place = null, size = null, fresh = null;
	// 글을 고치는 동안 서식 띠가 바꾼 서식 (요소 → style). 고치는 중에 파일을 쓰면 앱이 쪽을 다시 읽어 고치던 글이 끊긴다 — 마칠 때 함께 쓴다
	const pending = new Map();
	const style = document.createElement("style");
	style.textContent = `
		[data-deck-edit] .slide *:hover { outline: 1px solid rgba(229,72,45,.32); outline-offset: 1px; cursor: default }
		[data-deck-edit] [data-deck-sel] { outline: 1.5px solid #e5482d !important; outline-offset: 1px }
		[data-deck-edit] [contenteditable=true] { outline: 1.5px solid #e5482d !important; cursor: text }
		[data-deck-place], [data-deck-place] * { cursor: crosshair !important }
		#deck-ui { position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none }
		#deck-ui .h { position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px; box-sizing: border-box; background: #fff; border: 1.5px solid #e5482d; border-radius: 2px; pointer-events: auto }
		#deck-ui .guide { position: absolute; background: #d6336c; display: none }
		#deck-ui .guide.v { width: 1.5px !important } #deck-ui .guide.h { height: 1.5px !important }
		#deck-ui .ghost { position: absolute; box-sizing: border-box; border: 1.5px dashed #e5482d; background: rgba(229,72,45,.06) }`;
	document.head.appendChild(style);
	// 손잡이 · 그리는 틀은 .slide 밖(<html> 바로 밑)에 둔다 — 쪽 안에 두면 자식 번호 길이 원본과 어긋나고 굽기 · 뽑기에 섞인다
	const ui = document.createElement("div");
	ui.id = "deck-ui";
	const DIRS = { nw: "nwse", n: "ns", ne: "nesw", e: "ew", se: "nwse", s: "ns", sw: "nesw", w: "ew" };
	const handles = Object.entries(DIRS).map(([d, c]) => {
		const h = document.createElement("div");
		h.className = "h";
		h.dataset.dir = d;
		h.style.cursor = c + "-resize";
		h.style.display = "none";
		ui.appendChild(h);
		return h;
	});
	const ghost = document.createElement("div");
	ghost.className = "ghost";
	ghost.style.display = "none";
	ui.appendChild(ghost);
	// 붙기 안내선 — 세로 하나 · 가로 하나
	const [gx, gy] = ["v", "h"].map((k) => { const g = document.createElement("div"); g.className = "guide " + k; ui.appendChild(g); return g; });
	document.documentElement.appendChild(ui);
	const P = (v) => Math.round(v) + "px";

	const select = (el) => {
		if (sel) sel.removeAttribute("data-deck-sel");
		sel = el;
		if (sel) sel.setAttribute("data-deck-sel", "");
		placeHandles();
		announce();
	};
	const movable = (el) => !!el && el !== root && el.nodeType === 1 && ["absolute", "fixed"].includes(css(el).position);
	/** 끌어 옮기고 크기를 바꿀 수 있는 요소 — 절대 위치 상자, 그리고 흐름 배치(flex · grid · 보통 흐름)의 덩이 요소.
	 *  흐름 요소는 position: relative 와 left · top 어긋남으로 옮긴다. 이웃 요소의 자리는 그대로이고, 내보내기는 그린 자리를 재므로 PPTX 도 같다.
	 *  2026.11.25 : Claude 가 짓는 쪽은 대부분 흐름 배치라 절대 위치만 옮기게 하면 끌어 옮기기가 거의 먹지 않았다 */
	const canMove = (el) => {
		if (!el || el === root || el.nodeType !== 1 || !root.contains(el)) return false;
		if (movable(el)) return true;
		const s = css(el);
		return s.display !== "inline" && s.display !== "contents" && !s.display.startsWith("table") && ["static", "relative"].includes(s.position);
	};
	/** 옮기기 시작점 — 지금 left · top 과, 흐름 요소라 옮길 때 position: relative 를 붙여야 하는지 */
	const posOf = (el) => {
		const s = css(el), abs = movable(el);
		return { l: parseFloat(s.left) || (abs ? el.offsetLeft : 0), t: parseFloat(s.top) || (abs ? el.offsetTop : 0), rel: s.position === "static" };
	};
	/** 옮긴 뒤 원본에 쓸 style — 붙인 position: relative 도 함께 */
	const posPatch = (el, keys) => {
		const st = el.style.position ? { position: el.style.position } : {};
		for (const k of keys) st[k] = el.style[k];
		return st;
	};
	/** 상자 — 그 요소부터 위로 처음 만나는 절대 위치 요소. 글상자 · 도형 · 카드처럼 통째로 옮기는 단위 */
	const boxOf = (el) => { for (let e = el; e && e !== root && e !== document.body; e = e.parentElement) if (movable(e)) return e; return null; };
	/** 채우기 · 윤곽선 · 세로 맞춤이 닿는 요소 — 도형 안 글(외동 자식)을 골랐거나 고치는 중이면 그 도형 */
	const shapeOf = (el) => { let x = el; while (!movable(x) && x.parentElement && x.parentElement !== root && x.parentElement.children.length === 1) x = x.parentElement; return x; };
	const NOTEXT = "img, svg, table, video, canvas, iframe";
	const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
	// 글을 고칠 수 있는 요소 — 그림 · 표처럼 글 상자로 다루지 않는 것을 품지 않고, 글이 있거나 비어 있는 것(빈 도형 · 새 글상자).
	// 비어 있어도 선 · 띠처럼 납작한 것은 뺀다 — 고르고 Enter 를 누르면 선 안에 커서가 서서 선이 부푼다
	const editable = (el) => !!el && el !== root && root.contains(el) && !el.matches(NOTEXT) && !el.querySelector(NOTEXT) &&
		(!!(el.innerText || "").trim() || (el.children.length === 0 && shapeOf(el).getBoundingClientRect().height >= 8));
	/** 누른 자리에서 고칠 글 덩이 — 글 조각(span · b …)이면 그것을 품은 덩이까지 오르고, 외동 자식만 둔 상자면 그 자식까지 내려간다 */
	const textAt = (t, lim) => {
		let x = t;
		while (x && x !== lim && x !== root && INLINE.has(x.tagName)) x = x.parentElement;
		while (x && x.children.length === 1 && !ownText(x) && !INLINE.has(x.children[0].tagName) && !x.children[0].matches(NOTEXT)) x = x.children[0];
		return editable(x) ? x : null;
	};
	/** 원본에 쓸 HTML — 런타임이 붙인 표시(고름 · 고치는 중)를 걷는다 */
	const clean = (el) => {
		const c = el.cloneNode(true);
		for (const x of [c, ...c.querySelectorAll("*")]) { x.removeAttribute("data-deck-sel"); x.removeAttribute("contenteditable"); }
		return c;
	};

	/** 고른 것 · 고치는 글의 서식을 앱에 알린다 — 서식 띠가 눌린 단추 · 글자 크기 · 색을 보인다 */
	const announce = () => {
		const el = edit ? edit.el : sel;
		if (mode !== "edit" || !el || !el.isConnected) return post({ t: "sel", info: null });
		const b = shapeOf(el), s = css(el), bs = css(b);
		const side = ["Top", "Right", "Bottom", "Left"].find((k) => bs["border" + k + "Style"] !== "none" && parseFloat(bs["border" + k + "Width"]) > 0);
		post({ t: "sel", info: {
			tag: el.tagName.toLowerCase(), editing: !!edit, box: canMove(b), abs: movable(b), flex: bs.display.includes("flex"), image: b.tagName === "IMG",
			size: parseFloat(s.fontSize), lh: Math.round((parseFloat(s.lineHeight) / parseFloat(s.fontSize)) * 100) / 100 || null, bold: +s.fontWeight >= 600, italic: s.fontStyle === "italic", underline: s.textDecorationLine.includes("underline"),
			color: color(s.color)?.hex || null, align: s.textAlign,
			// 세로 맞춤은 띠의 세 값으로 — 계산 값 표기가 엔진마다 다르다 (WebView2 는 flex-start 를 flow-start 로 돌려준다)
			valign: /end/.test(bs.alignItems) ? "flex-end" : /center/.test(bs.alignItems) ? "center" : "flex-start",
			fill: color(bs.backgroundColor)?.hex || null,
			line: side ? { hex: color(bs["border" + side + "Color"])?.hex || null, w: parseFloat(bs["border" + side + "Width"]) } : null,
		} });
	};
	const placeHandles = () => {
		for (const h of handles) h.style.display = "none";
		if (mode !== "edit" || !sel || edit || !sel.isConnected || !canMove(sel)) return;
		const r = sel.getBoundingClientRect();
		// 선처럼 납작한 요소는 길이 손잡이만 — 두께는 서식 띠의 윤곽선 두께로 바꾼다
		const flatH = r.height < 8, flatW = r.width < 8;
		for (const h of handles) {
			const d = h.dataset.dir;
			if ((flatH && d !== "e" && d !== "w") || (flatW && d !== "n" && d !== "s")) continue;
			h.style.left = (d.includes("w") ? r.left : d.includes("e") ? r.right : (r.left + r.right) / 2) + "px";
			h.style.top = (d.includes("n") ? r.top : d.includes("s") ? r.bottom : (r.top + r.bottom) / 2) + "px";
			h.style.display = "";
		}
	};

	/** 서식을 바꾼다 — 고르는 중이면 바로 원본에 쓰고, 글을 고치는 중이면 마칠 때 함께 쓴다 */
	const setStyle = (el, st) => {
		// CSS 변수가 든 font 묶음(`font: 600 28px var(--font)`)은 먼저 낱 속성으로 푼다 — 크기 하나만 바꾸면 브라우저가
		// 나머지(글꼴 이름 · 굵기)를 빈 값으로 만들어 글꼴이 날아간다 (setLine 주석과 같은 까닭). 글꼴 이름의 변수는 그대로 살린다
		const raw = el.style.getPropertyValue("font");
		if (raw.includes("var(") && Object.keys(st).some((k) => k.startsWith("font-") || k === "line-height")) {
			const s = css(el);
			st = { font: "", "font-style": s.fontStyle, "font-weight": s.fontWeight, "font-size": s.fontSize, "line-height": s.lineHeight, "font-family": /(var\(--[^)]*\))\s*$/.exec(raw)?.[1] || s.fontFamily, ...st };
		}
		for (const [k, v] of Object.entries(st)) el.style.setProperty(k, v);
		if (edit) pending.set(el, { ...(pending.get(el) || {}), ...st });
		else { keep(sel || el); post({ t: "patch", path: pathOf(el), style: st }); }
		placeHandles();
		announce();
	};
	const flushPending = () => {
		for (const [el, st] of pending) if (el.isConnected) post({ t: "patch", path: pathOf(el), style: st });
		pending.clear();
	};

	/** 글 고치기를 시작한다. at 이 있으면 그 자리에 커서, all 이면 글 전체를 고른다. 둘 다 없으면 브라우저가 고른 그대로(두 번 누르기의 낱말) */
	const startEdit = (el, at, all) => {
		if (edit || place || !(el === fresh || editable(el))) return;
		edit = { el, before: el.innerHTML, cancel: false };
		select(null);
		// 빈 요소는 높이가 없어 커서가 서지 않는다 — 고치는 동안만 <br> 로 한 줄을 세운다 (마칠 때 글이 없으면 걷는다)
		if (!el.innerHTML.trim()) el.innerHTML = "<br>";
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
		announce();
	};
	const finishEdit = () => {
		if (!edit) return;
		const { el, before, cancel } = edit;
		edit = null;
		el.removeAttribute("contenteditable");
		if (cancel) el.innerHTML = before;
		if (!(el.innerText || "").trim() && !el.querySelector(NOTEXT)) el.innerHTML = "";
		if (fresh) {
			// 새 글상자는 아직 원본에 없다 — 쓴 글 · 서식을 담아 통째로 덧붙인다. 아무것도 안 썼으면 걷는다
			const box = fresh;
			fresh = null;
			pending.clear();
			if (!box.innerHTML) { box.remove(); if (!sel) announce(); return; }
			keep(box);
			post({ t: "append", html: clean(box).outerHTML });
			if (!sel) select(box);
			return;
		}
		flushPending();
		// 상자(도형 · 글상자 · 카드) 안 글을 마쳤으면 그 상자를 고른 채로 둔다 — 이어서 채우기 · 옮기기를 한다 (PowerPoint 와 같다)
		const box = boxOf(el) || el;
		if (el.innerHTML !== before) { keep(box); post({ t: "edit", path: pathOf(el), html: el.innerHTML }); }
		// Enter · Esc 로 마쳤으면 그 요소를 고른 채로 둔다. 다른 요소를 눌러 마쳤으면 그 요소가 이미 골라져 있다 — 덮지 않는다
		if (!sel) select(box);
		else announce();
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

	// ── 넣기 ── 서식 띠에서 고른 것을 끌어서 그린다
	const setPlace = (p) => {
		if (p && edit) edit.el.blur();
		place = p;
		document.documentElement.toggleAttribute("data-deck-place", !!p);
		ghost.style.display = "none";
		if (p) select(null);
		post({ t: "placing", kind: p ? p.kind : null });
	};
	const slideXY = (e) => { const S = root.getBoundingClientRect(); return [e.clientX - S.left, e.clientY - S.top]; };
	/** 그리는 틀 — 선은 가로 · 세로 중 긴 쪽으로 곧게, Shift 면 정사각형 */
	const placeRect = (e) => {
		const [x, y] = slideXY(e), { x0, y0, kind } = place;
		let w = x - x0, h = y - y0;
		if (kind === "line") { if (Math.abs(w) >= Math.abs(h)) h = 0; else w = 0; }
		else if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
		return { x: Math.min(x0, x0 + w), y: Math.min(y0, y0 + h), w: Math.abs(w), h: Math.abs(h) };
	};
	// 도형 — 글은 안쪽 <p> 에 둔다. 가운데 맞춤을 flex 로 하는데, 글을 flex 상자에 바로 넣으면 Shift+Enter 의 <br> 가 줄을 못 바꾼다.
	// 내보낼 때 바깥 상자는 PowerPoint 도형, <p> 는 그 위 글상자가 되어 한 그룹으로 묶인다
	const SHAPE = "display:flex;align-items:center;justify-content:center;text-align:center;padding:12px 16px;background:var(--accent, #2f6fde);color:var(--paper, #fff)";
	const makeEl = (kind, r) => {
		const at = `position:absolute;left:${P(r.x)};top:${P(r.y)};`;
		const t = document.createElement("template");
		if (kind === "text") t.innerHTML = `<div style="${at}width:${P(r.w)}"><br></div>`;
		else if (kind === "line") t.innerHTML = r.h > r.w
			? `<div style="${at}width:0;height:${P(r.h)};border-left:var(--stroke, 2px) solid var(--ink, #222)"></div>`
			: `<div style="${at}width:${P(r.w)};height:0;border-top:var(--stroke, 2px) solid var(--ink, #222)"></div>`;
		else t.innerHTML = `<div style="${at}width:${P(r.w)};height:${P(r.h)};${SHAPE}${kind === "round" ? ";border-radius:16px" : kind === "ellipse" ? ";border-radius:50%" : ""}"><p style="margin:0;width:100%"></p></div>`;
		return t.content.firstElementChild;
	};
	const finishPlace = (e) => {
		const p = place;
		let r = placeRect(e);
		const D = { text: [360, 0], line: [240, 0], rect: [200, 120], round: [200, 120], ellipse: [160, 160] }[p.kind] || [200, 120];
		// 누르기만 했다 — 누른 자리를 왼쪽 위로 기본 크기
		if (r.w < 6 && r.h < 6) r = { x: p.x0, y: p.y0, w: D[0], h: D[1] };
		else if (p.kind === "text") r.w = Math.max(r.w, 40);
		setPlace(null);
		const el = makeEl(p.kind, r);
		root.appendChild(el);
		if (p.kind === "text") { fresh = el; startEdit(el, null, true); return; }
		keep(el);
		post({ t: "append", html: clean(el).outerHTML });
		select(el);
	};
	/** 그림 — 쪽의 60% 안에 들게 줄여 가운데에 놓는다 */
	const putImage = async (src) => {
		if (edit) edit.el.blur();
		const probe = new Image();
		probe.src = src;
		await within(probe.decode(), 5000);
		const S = root.getBoundingClientRect(), nw = probe.naturalWidth || 400, nh = probe.naturalHeight || 300;
		const k = Math.min(1, (S.width * 0.6) / nw, (S.height * 0.6) / nh), w = nw * k, h = nh * k;
		const el = document.createElement("img");
		el.setAttribute("src", src);
		el.setAttribute("alt", "");
		el.setAttribute("style", `position:absolute;left:${P((S.width - w) / 2)};top:${P((S.height - h) / 2)};width:${P(w)};height:${P(h)}`);
		root.appendChild(el);
		keep(el);
		post({ t: "append", html: el.outerHTML });
		select(el);
	};

	// ── 요소 ── 순서 · 맞춤 · 복제 · 복사
	const arrange = (how) => {
		// 흐름 요소는 순서를 바꾸면 겹침이 아니라 배치 차례가 바뀐다 — 절대 위치 상자만
		if (!movable(shapeOf(sel))) return;
		const el = shapeOf(sel), p = el.parentElement, n = p.children.length, i = [...p.children].indexOf(el);
		const to = how === "front" ? n - 1 : how === "back" ? 0 : how === "forward" ? Math.min(n - 1, i + 1) : Math.max(0, i - 1);
		if (to === i) return;
		const from = pathOf(el);
		el.remove();
		p.insertBefore(el, p.children[to] ?? null);
		keep(el);
		post({ t: "order", path: from, to });
		select(el);
	};
	/** 쪽 가장자리 · 가운데에 맞춘다 (PowerPoint 「슬라이드에 맞춤」). 그린 자리와 쪽의 차이만큼 left · top 을 민다 — 절대 · 흐름 요소에 같이 맞는다 */
	const alignTo = (how) => {
		const el = shapeOf(sel);
		if (!canMove(el)) return;
		const r = el.getBoundingClientRect(), S = root.getBoundingClientRect(), p = posOf(el);
		const dx = { left: S.left - r.left, center: S.left + (S.width - r.width) / 2 - r.left, right: S.right - r.right }[how];
		const dy = { top: S.top - r.top, middle: S.top + (S.height - r.height) / 2 - r.top, bottom: S.bottom - r.bottom }[how];
		setStyle(el, { ...(p.rel ? { position: "relative" } : {}), ...(dx != null ? { left: P(p.l + dx) } : { top: P(p.t + dy) }) });
	};
	const dup = () => {
		const el = shapeOf(sel), c = clean(el);
		if (movable(el)) { c.style.left = P((parseFloat(css(el).left) || el.offsetLeft) + 20); c.style.top = P((parseFloat(css(el).top) || el.offsetTop) + 20); }
		const path = pathOf(el);
		el.after(c);
		keep(c);
		post({ t: "after", path, html: c.outerHTML });
		select(c);
	};
	/** 복사 — 다른 쪽에 붙여도 같은 자리 · 크기로 서게 절대 위치로 바꿔 넘긴다 (붙여 넣기는 쪽 맨 위에 놓는다) */
	const copy = () => {
		const el = shapeOf(sel), c = clean(el);
		if (!movable(el) || el.offsetParent !== root) {
			const r = el.getBoundingClientRect(), S = root.getBoundingClientRect();
			Object.assign(c.style, { position: "absolute", left: P(r.left - S.left), top: P(r.top - S.top), width: P(r.width), margin: "0" });
		}
		post({ t: "copy", html: c.outerHTML });
	};
	const paste = (html, dx) => {
		const t = document.createElement("template");
		t.innerHTML = String(html || "").trim();
		const el = t.content.firstElementChild;
		if (!el) return;
		if (dx) { el.style.left = P((parseFloat(el.style.left) || 0) + dx); el.style.top = P((parseFloat(el.style.top) || 0) + dx); }
		root.appendChild(el);
		keep(el);
		post({ t: "append", html: el.outerHTML });
		select(el);
	};

	// ── 서식 ──
	/** 글을 고치는 중에 글자 일부를 골랐는가 — 그러면 굵게 · 색은 고른 글자에만 */
	const ranged = () => {
		if (!edit) return false;
		const s = getSelection();
		return !!s.rangeCount && !s.isCollapsed && edit.el.contains(s.anchorNode);
	};
	const exec = (c, v) => { document.execCommand("styleWithCSS", false, true); document.execCommand(c, false, v); announce(); };
	/** var(--accent) 같은 색을 rgb 로 — execCommand 는 CSS 변수를 받지 않는다 */
	const rgbOf = (v) => {
		const probe = document.createElement("span");
		probe.style.color = v;
		root.appendChild(probe);
		const c = css(probe).color;
		probe.remove();
		return c;
	};
	const toggle = (what) => {
		if (ranged()) return exec(what);
		const el = edit ? edit.el : sel, s = css(el);
		if (what === "bold") setStyle(el, { "font-weight": +s.fontWeight >= 600 ? "400" : "700" });
		else if (what === "italic") setStyle(el, { "font-style": s.fontStyle === "italic" ? "normal" : "italic" });
		else setStyle(el, { "text-decoration": s.textDecorationLine.includes("underline") ? "none" : "underline" });
	};
	/** 윤곽선 — 한 변만 그은 요소(선 · 밑줄 띠)는 그 변만 바꾼다. 네 변을 다 켜면 선이 상자가 된다.
	 *  늘 묶음 속성(border · border-top …) 전체를 다시 쓴다. `border: 1px solid var(--line)` 처럼 CSS 변수가 든 묶음에서
	 *  border-top-width 하나만 바꾸면 브라우저가 나머지 낱 속성을 빈 값으로 만들어 원본에 `border-top-style: ;` 가 남고 선이 사라진다 (2026.11.25 실측) */
	const setLine = (el, v) => {
		if (v.none) return setStyle(el, { border: "none" });
		const s = css(el), all = ["top", "right", "bottom", "left"];
		const on = all.filter((k) => s.getPropertyValue(`border-${k}-style`) !== "none" && parseFloat(s.getPropertyValue(`border-${k}-width`)) > 0);
		const of = (k) => `${v.width ? v.width + "px" : on.length ? s.getPropertyValue(`border-${k}-width`) : "2px"} ${on.length ? s.getPropertyValue(`border-${k}-style`) : "solid"} ${v.color || (on.length ? s.getPropertyValue(`border-${k}-color`) : "var(--ink, #222)")}`;
		if (!on.length || on.length === 4) return setStyle(el, { border: of(on[0] || "top") });
		setStyle(el, Object.fromEntries(on.map((k) => [`border-${k}`, of(k)])));
	};
	/** 서식 띠가 보낸 명령 */
	const command = (cmd, v, m) => {
		if (cmd === "place") return setPlace(v ? { kind: v } : null);
		if (cmd === "image") return void putImage(v);
		if (cmd === "paste") return paste(v, m.dx || 0);
		// 순서 · 맞춤 · 복제 · 지우기는 고친 글을 먼저 마친다 — 고치는 중인 요소의 번호 길이 바뀌면 글이 엉뚱한 요소에 쓰인다
		if (["arrange", "alignTo", "dup", "remove", "copy"].includes(cmd) && edit) edit.el.blur();
		const el = edit ? edit.el : sel;
		if (!el) return;
		const b = shapeOf(el);
		if (cmd === "toggle") toggle(v);
		else if (cmd === "color") { if (ranged()) exec("foreColor", rgbOf(v)); else setStyle(el, { color: v }); }
		// 글자 크기는 pt 로 받는다 (PowerPoint 와 같은 수). 쪽 1px = 0.75pt
		else if (cmd === "size") setStyle(el, { "font-size": Math.round((v / 0.75) * 100) / 100 + "px" });
		else if (cmd === "align") setStyle(el, { "text-align": v });
		// 줄 간격 — 글자 크기의 배수로 쓴다 (단위 없는 line-height). 내보낼 때는 그린 줄 높이(px)를 잰다
		else if (cmd === "lineHeight") setStyle(el, { "line-height": String(v) });
		else if (cmd === "valign") setStyle(b, { "align-items": v });
		else if (cmd === "fill") setStyle(b, { background: v });
		else if (cmd === "line") setLine(b, v);
		else if (cmd === "arrange") arrange(v);
		else if (cmd === "alignTo") alignTo(v);
		else if (cmd === "dup") dup();
		else if (cmd === "copy") { if (sel) copy(); }
		else if (cmd === "remove") { const x = shapeOf(sel); post({ t: "remove", path: pathOf(x) }); x.remove(); select(null); }
	};

	// ── 붙기 ── 끌어 옮길 때 쪽 가장자리 · 가운데, 이웃 요소의 가장자리 · 가운데에 붙는다. Alt 를 누르고 끌면 붙지 않는다 (PowerPoint 와 같다)
	const SNAP = 8;
	/** 끌기 시작 때 붙을 자리를 모은다 — 쪽, 쪽의 자식들, 끄는 요소의 형제들 (끄는 요소 · 그 조상 · 자손은 빼고) */
	const snapTargets = (el) => {
		const S = root.getBoundingClientRect(), xs = [0, S.width / 2, S.width], ys = [0, S.height / 2, S.height];
		const near = new Set([...root.children, ...(el.parentElement ? el.parentElement.children : [])]);
		for (const o of near) {
			if (o === el || o.contains(el) || el.contains(o) || o.id === "deck-ui" || !visible(o)) continue;
			const r = o.getBoundingClientRect();
			if (r.width < 4 && r.height < 4) continue;
			xs.push(r.left - S.left, r.left - S.left + r.width / 2, r.right - S.left);
			ys.push(r.top - S.top, r.top - S.top + r.height / 2, r.bottom - S.top);
		}
		const r0 = el.getBoundingClientRect();
		return { xs, ys, x0: r0.left - S.left, y0: r0.top - S.top, w: r0.width, h: r0.height, S };
	};
	/** 옮긴 만큼(dx, dy)에서 가장 가까운 붙을 자리로 고친 어긋남과 안내선 */
	const snapMove = (z, dx, dy) => {
		const best = (own, cands) => {
			let b = null;
			for (const o of own) for (const c of cands) { const d = c - o; if (Math.abs(d) <= SNAP && (!b || Math.abs(d) < Math.abs(b.d))) b = { d, at: c }; }
			return b;
		};
		const x = z.x0 + dx, y = z.y0 + dy;
		const bx = best([x, x + z.w / 2, x + z.w], z.xs), by = best([y, y + z.h / 2, y + z.h], z.ys);
		return { dx: dx + (bx ? bx.d : 0), dy: dy + (by ? by.d : 0), gx: bx?.at, gy: by?.at };
	};
	const showGuides = (z, g) => {
		Object.assign(gx.style, g?.gx != null ? { display: "block", left: z.S.left + g.gx - 0.5 + "px", top: z.S.top + "px", width: "1px", height: z.S.height + "px" } : { display: "none" });
		Object.assign(gy.style, g?.gy != null ? { display: "block", top: z.S.top + g.gy - 0.5 + "px", left: z.S.left + "px", height: "1px", width: z.S.width + "px" } : { display: "none" });
	};

	addEventListener("pointerdown", (e) => {
		if (mode !== "edit") return;
		if (place) {
			if (e.button !== 0) return setPlace(null);
			[place.x0, place.y0] = slideXY(e);
			e.preventDefault();
			return;
		}
		// 크기 손잡이
		const hd = e.target.closest?.("#deck-ui .h");
		if (hd) {
			if (sel && e.button === 0) {
				const p = posOf(sel);
				size = { el: sel, dir: hd.dataset.dir, x: e.clientX, y: e.clientY, l: p.l, t: p.t, rel: p.rel, w: sel.offsetWidth, h: sel.offsetHeight, img: sel.tagName === "IMG", props: new Set() };
				hd.setPointerCapture(e.pointerId);
			}
			e.preventDefault();
			return;
		}
		const t = e.target.closest("[contenteditable=true]") ? null : e.target;
		if (!t || t === root || t === document.body || t === document.documentElement) return select(null);
		const m = boxOf(t);
		// 고른 상자를 다시 누름 — 끌면 옮기고, 끌지 않고 떼면 누른 자리 글 고치기. 두 번 누르기의 둘째 누름과 가르려고 시간을 본다
		if (m && m === sel && e.button === 0 && Date.now() - picked > 450) {
			drag = { el: m, x: e.clientX, y: e.clientY, ...posOf(m), moved: false, again: true, hit: t };
			e.preventDefault();
			return;
		}
		// 상자 밖에서 왔으면 상자를 고른다. 이미 상자 안의 요소를 골라 들어와 있으면 누른 요소를 그대로 고른다
		const el = m && (m === sel || !(sel && m.contains(sel))) ? m : t;
		const again = el === sel && e.button === 0 && Date.now() - picked > 450;
		if (el !== sel) picked = Date.now();
		select(el);
		// 우클릭은 고르기만 한다 — 끌기를 시작하면 메뉴를 여는 동안 요소가 손에 붙는다.
		// 옮길 수 있는 요소는 끌기부터 — 끌지 않고 떼었고 이미 골라 둔 요소였으면 그때 글 고치기 (pointerup)
		if (canMove(el) && e.button === 0) {
			drag = { el, x: e.clientX, y: e.clientY, ...posOf(el), moved: false, again, hit: t };
			e.preventDefault();
			return;
		}
		if (again) {
			const tt = textAt(t, el);
			if (tt) return startEdit(tt, { x: e.clientX, y: e.clientY });
		}
	}, true);
	addEventListener("pointermove", (e) => {
		if (place && place.x0 != null) {
			const r = placeRect(e), S = root.getBoundingClientRect();
			Object.assign(ghost.style, { display: "", left: S.left + r.x + "px", top: S.top + r.y + "px", width: Math.max(2, r.w) + "px", height: Math.max(2, r.h) + "px" });
			return;
		}
		if (size) {
			const d = size.dir, dx = e.clientX - size.x, dy = e.clientY - size.y;
			let w = size.w + (d.includes("e") ? dx : d.includes("w") ? -dx : 0);
			let h = size.h + (d.includes("s") ? dy : d.includes("n") ? -dy : 0);
			if (d.length === 2 && (e.shiftKey || size.img)) { const k = Math.max(w / size.w, h / size.h); w = size.w * k; h = size.h * k; }
			w = Math.max(Math.min(8, size.w), w);
			h = Math.max(Math.min(8, size.h), h);
			const st = size.el.style;
			if (/[ew]/.test(d)) { st.width = P(w); size.props.add("width"); }
			if (/[ns]/.test(d)) { st.height = P(h); size.props.add("height"); }
			if (d.includes("w")) { st.left = P(size.l + size.w - w); size.props.add("left"); }
			if (d.includes("n")) { st.top = P(size.t + size.h - h); size.props.add("top"); }
			if (size.rel && (d.includes("w") || d.includes("n"))) st.position = "relative";
			placeHandles();
			return;
		}
		if (!drag) return;
		let dx = e.clientX - drag.x, dy = e.clientY - drag.y;
		if (!drag.moved && Math.hypot(dx, dy) < 3) return;
		if (!drag.moved) drag.z = snapTargets(drag.el);
		drag.moved = true;
		const g = e.altKey ? null : snapMove(drag.z, dx, dy);
		if (g) ({ dx, dy } = g);
		showGuides(drag.z, g);
		if (drag.rel) drag.el.style.position = "relative";
		drag.el.style.left = Math.round(drag.l + dx) + "px";
		drag.el.style.top = Math.round(drag.t + dy) + "px";
		placeHandles();
	});
	addEventListener("pointerup", (e) => {
		if (place && place.x0 != null) return finishPlace(e);
		if (size) {
			if (size.props.size) { keep(size.el); post({ t: "patch", path: pathOf(size.el), style: posPatch(size.el, size.props) }); }
			size = null;
			return;
		}
		if (drag?.moved) { showGuides(null, null); keep(drag.el); post({ t: "patch", path: pathOf(drag.el), style: posPatch(drag.el, ["left", "top"]) }); }
		// 고른 상자를 끌지 않고 뗐다 — 누른 자리 글 고치기. 글이 없는 자리(그림 · 아이콘)면 그 요소를 고른다
		else if (drag?.again) {
			const tt = textAt(drag.hit, drag.el);
			if (tt) startEdit(tt, { x: e.clientX, y: e.clientY });
			else if (drag.hit !== drag.el) select(drag.hit);
		}
		drag = null;
	});
	/** 그 자리의 낱말 범위 — 띄어쓰기로 가른다 (한글은 어절) */
	const wordAt = (x, y) => {
		const r = document.caretRangeFromPoint(x, y);
		if (!r || r.startContainer.nodeType !== 3) return null;
		const s = r.startContainer.nodeValue;
		let a = r.startOffset, b = a;
		while (a > 0 && /\S/.test(s[a - 1])) a--;
		while (b < s.length && /\S/.test(s[b])) b++;
		if (a === b) return null;
		const w = document.createRange();
		w.setStart(r.startContainer, a);
		w.setEnd(r.startContainer, b);
		return w;
	};
	// 두 번 누르기 — 글 고치기를 시작하고 누른 낱말을 고른다. 끌기 때문에 누름의 기본 동작을 막아서 브라우저가 낱말을 고르지 않는다 —
	// 그래서 직접 고른다 (2026.11.25 : 낱말이 안 골라져 두 번 누른 뒤 굵게를 누르면 글 전체가 굵어졌다)
	addEventListener("dblclick", (e) => {
		if (mode !== "edit" || edit || place || e.target.closest?.("#deck-ui")) return;
		const tt = textAt(e.target, null);
		startEdit(tt);
		const w = edit && wordAt(e.clientX, e.clientY);
		if (w && tt.contains(w.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(w); }
	});
	// 휠 · 쪽 넘김 키는 앱으로 넘긴다 — 슬라이드 창이 받아 버리면 무대 위에서 휠을 굴리거나, 슬라이드를 한 번 누른 뒤 방향키를 눌러도 쪽이 안 넘어간다
	addEventListener("wheel", (e) => post({ t: "wheel", dy: e.deltaY }), { passive: true });
	// 우클릭도 앱으로 넘긴다 — 웹뷰 기본 메뉴(뒤로 · 새로 고침)는 슬라이드 창을 엉뚱한 곳으로 보낸다.
	// 글자를 고치는 중이면 기본 메뉴(붙여 넣기 · 맞춤법)를 그대로 쓴다
	addEventListener("contextmenu", (e) => {
		if (e.target.isContentEditable) return;
		e.preventDefault();
		const el = e.target.nodeType === 1 && root.contains(e.target) ? (sel && sel.contains(e.target) ? sel : e.target) : root;
		post({ t: "menu", x: e.clientX, y: e.clientY, path: pathOf(el), tag: el.tagName.toLowerCase(), text: el === root ? "" : label(el) });
	});
	addEventListener("keydown", (e) => {
		const k = e.key.toLowerCase(), ctrl = e.ctrlKey && !e.altKey;
		// 되돌리기 · 다시 하기는 앱이 한다 (손으로 고친 것을 파일째 되쓴다). 글자를 고치는 중이면 그 글의 되돌리기를 쓴다
		if (ctrl && ["z", "y"].includes(k) && !document.activeElement?.isContentEditable) {
			// 아직 파일에 쓰지 않은 방향키 이동이 있으면 먼저 쓴다 — 안 그러면 되돌린 뒤에 늦게 쓰여 되돌림을 덮는다
			if (sel?.__nudge) { clearTimeout(sel.__nudge); sel.__nudge = null; post({ t: "patch", path: pathOf(sel), style: posPatch(sel, ["left", "top"]) }); }
			post({ t: k === "y" || e.shiftKey ? "redo" : "undo" });
			e.preventDefault();
			return;
		}
		// 고른 요소가 없으면(보기만 하는 중) 넘김 키는 쪽을 넘긴다 — 고르기 도구가 늘 켜져 있어도 방향키로 쪽을 넘길 수 있게
		if ((mode !== "edit" || !sel) && !place && !document.activeElement?.isContentEditable && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End"].includes(e.key) && !e.ctrlKey && !e.altKey) {
			post({ t: "key", key: e.key });
			e.preventDefault();
			return;
		}
		// 도구 키(V · 1~4 · C · S · F)도 앱으로 넘긴다 — 슬라이드를 한 번 누르면 포커스가 이 창에 와서 앱이 키를 못 받는다
		if (!edit && !e.ctrlKey && !e.altKey && !e.metaKey && /^[vepcsf1-4]$/i.test(e.key) && !document.activeElement?.isContentEditable) {
			if (place) setPlace(null);
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
		if (place) { if (e.key === "Escape") { setPlace(null); e.preventDefault(); } return; }
		// 붙여 넣기는 고른 것이 없어도 된다 — 복사한 요소는 앱이 들고 있다가 paste 명령으로 돌려준다
		if (ctrl && k === "v") { post({ t: "pasteReq" }); e.preventDefault(); return; }
		if (!sel) return;
		if (ctrl && k === "c") { copy(); e.preventDefault(); }
		else if (ctrl && k === "d") { dup(); e.preventDefault(); }
		else if (ctrl && ["b", "i", "u"].includes(k)) { toggle({ b: "bold", i: "italic", u: "underline" }[k]); e.preventDefault(); }
		else if (e.ctrlKey || e.altKey) return;
		else if ((e.key === "Enter" || e.key === "F2") && textAt(sel, null)) {
			startEdit(textAt(sel, null), null, true);
			e.preventDefault();
		} else if (e.key === "Delete" || e.key === "Backspace") {
			post({ t: "remove", path: pathOf(sel) });
			select(null);
		} else if (e.key.startsWith("Arrow") && canMove(sel)) {
			const d = e.shiftKey ? 10 : 1, { l, t, rel } = posOf(sel);
			if (rel) sel.style.position = "relative";
			if (e.key === "ArrowLeft") sel.style.left = l - d + "px";
			if (e.key === "ArrowRight") sel.style.left = l + d + "px";
			if (e.key === "ArrowUp") sel.style.top = t - d + "px";
			if (e.key === "ArrowDown") sel.style.top = t + d + "px";
			placeHandles();
			clearTimeout(sel.__nudge);
			const el = sel;
			sel.__nudge = setTimeout(() => { keep(el); post({ t: "patch", path: pathOf(el), style: posPatch(el, ["left", "top"]) }); }, 400);
			e.preventDefault();
		} else if (e.key === "Escape") select(null);
	});

	addEventListener("message", async (e) => {
		const m = e.data;
		if (!m || !m.__deck) return;
		if (m.t === "css") {
			document.querySelectorAll("link[rel=stylesheet]").forEach((l) => { l.href = l.href.split("?")[0] + "?t=" + Date.now(); });
			setTimeout(placeHandles, 300);
		} else if (m.t === "mode") {
			mode = m.mode;
			document.documentElement.toggleAttribute("data-deck-edit", mode === "edit");
			if (mode !== "edit") { if (place) setPlace(null); select(null); }
			else {
				let k = null;
				try { k = JSON.parse(sessionStorage.getItem(KEEP) || "null"); sessionStorage.removeItem(KEEP); } catch {}
				const el = k && Date.now() - k.at < 5000 && k.path ? atPath(k.path) : null;
				if (el && el !== root) { select(el); picked = Date.now(); window.focus(); }
				// 다시 읽은 쪽이면 띠에 지금 고른 것(없으면 없음)을 알린다 — 띠가 옛 쪽의 고른 것을 들고 있지 않게
				else announce();
			}
		} else if (m.t === "cmd") {
			if (mode === "edit") command(m.cmd, m.v, m);
		} else if (m.t === "hit") {
			const el = document.elementFromPoint(m.x, m.y) || root;
			post({ t: "hit", req: m.req, path: pathOf(el), tag: el.tagName.toLowerCase(), text: el === root ? "" : label(el), cls: el.className && typeof el.className === "string" ? el.className : "" });
		} else if (m.t === "selHit") {
			// 고른 요소 — 「요청에 넣기」가 그 요소 가운데에 핀을 꽂는다 (자리 · 경로 · 글). 글을 고치는 중이면 고치는 요소
			const el = sel || (edit && edit.el);
			if (!el || el === root) post({ t: "selHit", req: m.req, none: true });
			else {
				const r = el.getBoundingClientRect();
				post({ t: "selHit", req: m.req, path: pathOf(el), tag: el.tagName.toLowerCase(), text: label(el), x: r.left + r.width / 2, y: r.top + r.height / 2 });
			}
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
		} else if (m.t === "audit") {
			try { await within(document.fonts.ready, 3000); post({ t: "audited", req: m.req, data: auditNodes() }); }
			catch (err) { post({ t: "audited", req: m.req, error: String(err) }); }
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
	// 감사(audit.ts)용 — 보이는 요소마다 그려진 자리와 계산된 서식. 굽지 않아 extract 보다 훨씬 빠르다.
	// SVG 속은 그림이라 세지 않는다 (그림 안 색 · 글꼴은 템플릿 밖이어도 PowerPoint 에서 그림이다)
	const auditNodes = () => {
		const S = root.getBoundingClientRect();
		const nodes = [];
		for (const el of [root, ...root.querySelectorAll("*")]) {
			const tag = el.tagName.toLowerCase();
			if (el !== root && el.parentElement && el.parentElement.closest("svg")) continue;
			if (!visible(el)) continue;
			const r = el.getBoundingClientRect();
			if (r.width < 1 || r.height < 1) continue;
			const s = css(el);
			const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(" ").replace(/\s+/g, " ").trim();
			// 글이 실제로 놓인 범위 — 칸이 쪽 너비 전체여도 가운데 맞춤 글은 가장자리에서 멀다. 여백은 이것으로 잰다
			let tb = null;
			if (own) {
				const rg = document.createRange();
				for (const n of el.childNodes) {
					if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
					rg.selectNodeContents(n);
					const q = rg.getBoundingClientRect();
					if (!q.width) continue;
					tb = tb ? { l: Math.min(tb.l, q.left), t: Math.min(tb.t, q.top), r: Math.max(tb.r, q.right), b: Math.max(tb.b, q.bottom) } : { l: q.left, t: q.top, r: q.right, b: q.bottom };
				}
			}
			const fill = color(s.backgroundColor);
			const bw = Math.max(...["Top", "Right", "Bottom", "Left"].map((k) => (s["border" + k + "Style"] !== "none" ? parseFloat(s["border" + k + "Width"]) || 0 : 0)));
			nodes.push({
				path: pathOf(el), tag, cls: typeof el.className === "string" ? el.className : "",
				x: Math.round(r.left - S.left), y: Math.round(r.top - S.top), w: Math.round(r.width), h: Math.round(r.height),
				text: own.slice(0, 300),
				tbox: tb ? { x: Math.round(tb.l - S.left), y: Math.round(tb.t - S.top), w: Math.round(tb.r - tb.l), h: Math.round(tb.b - tb.t) } : null,
				font: s.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
				size: Math.round(parseFloat(s.fontSize) * 10) / 10, weight: +s.fontWeight || 400,
				color: own ? color(s.color)?.hex || null : null,
				fill: fill && fill.alpha > 0.05 ? fill.hex : null,
				border: bw > 0 ? color(s.borderTopColor)?.hex || null : null,
				radius: parseFloat(s.borderTopLeftRadius) || 0,
				shadow: s.boxShadow !== "none", tshadow: s.textShadow !== "none",
				gradient: /gradient\(/.test(s.backgroundImage), clip: (s.webkitBackgroundClip || s.backgroundClip) === "text",
				upper: s.textTransform === "uppercase", ls: parseFloat(s.letterSpacing) || 0,
				li: s.display === "list-item",
			});
		}
		return { w: S.width, h: S.height, nodes };
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
					// 끝 맞춤은 표기가 엔진마다 다르다 — WebView2 는 flex-end 를 flow-end 로 돌려준다. 그래서 「end 로 끝나는가」로 본다
					// (2026.11.25 : flex-end 만 보아 아래 맞춤 글이 PPTX 에서 위 맞춤으로 나갔다)
					const END = /(^|-)end$/;
					const valign = flex ? (s.alignItems === "center" ? "middle" : END.test(s.alignItems) ? "bottom" : "top") : s.verticalAlign === "middle" ? "middle" : "top";
					let align = s.textAlign;
					if (flex && (s.justifyContent === "center")) align = "center";
					if (flex && (END.test(s.justifyContent) || s.justifyContent === "right")) align = "right";
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
