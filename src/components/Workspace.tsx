// 작업 화면 — 왼쪽 쪽 목록 · 가운데 무대(슬라이드 + 도구 띠) · 오른쪽 대화. 판 목록은 제목 줄(TitleBar)에 있다.
//
// 목차
//   SlideFrame    슬라이드 iframe 하나. 크기를 맞춰 줄이고, 다시 그릴 표식(rev)이 바뀌면 새로 읽는다
//   Rail          쪽 목록 — 끌어서 순서 바꾸기 · Delete 로 빼기 · 쪽 사이 + 로 빈 쪽 · 판 비교 중이면 바뀐 쪽 · 새 쪽 표시
//   Stage         무대 — 도구(고르기 · 펜 · 화살표 · 상자) · 직접 편집 메시지 받기 · 지난 판 미리 보기 · 휠로 쪽 넘기기 · 판 비교 (VersionLens.tsx)
//   MarkLayer     표시 층 — 그어 놓은 표시를 그리고, 긋는 도구일 때 긋기를 받는다 · StageTools 도구 띠
//   Flow          이어 보기 — 모든 쪽을 세로로 늘어놓고 스크롤로 넘긴다. 가운데 온 쪽이 지금 쪽이 된다
//   우클릭 메뉴   slideItems(쪽 목록 · 이어 보기) · Stage 의 무대 메뉴 — 메뉴 틀은 ContextMenu.tsx
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { deckUrl } from "../lib/api";
import { type Deck } from "../lib/deck";
import { ask, onFrame } from "../lib/frames";
import { useT } from "../lib/i18n";
import { anchor, bbox, MARK, type Shape, shapePath, tiny, type Tool } from "../lib/markup";
import { type Pin, useDeck } from "../lib/store";
import { type MenuItem, openMenu } from "./ContextMenu";
import { VersionBar, VersionLens } from "./VersionLens";
import { SketchBoard } from "./Sketch";
import { EditingNote, SlideFaces, StageFaces } from "./Collab";
import { remote } from "../lib/transport";
import { useSettings } from "../lib/settings";
import Talk, { useTalkFold } from "./Talk";

export function SlideFrame({ file, rev, width, height, w, h, onWin, revHash }: { file: string; rev: number; width: number; height?: number; w: number; h: number; onWin?: (win: Window | null) => void; revHash?: string }) {
	const id = useDeck((s) => s.id);
	const frames = useDeck((s) => s.frames);
	const mode = useDeck((s) => s.mode);
	const ref = useRef<HTMLIFrameElement>(null);
	// 읽힌 창 — 떼어 낼 때는 iframe.contentWindow 가 이미 null 이라 그것으로는 frames 에서 지우지 못하고 쌓였다
	const winRef = useRef<Window | null>(null);
	const s = width / w;
	const src = deckUrl(id, file, revHash) + `?v=${rev}`;
	useEffect(() => {
		const f = ref.current;
		return () => {
			const win = winRef.current ?? f?.contentWindow;
			if (win) frames.delete(win);
			winRef.current = null;
			onWin?.(null);
		};
	}, [src]);
	return (
		<iframe
			ref={ref}
			src={src}
			// 협업 브라우저에서는 슬라이드를 다른 출처로 — 슬라이드 안 스크립트가 앱 화면에 손대거나 이 사람 이름으로 의도를 보내지 못하게 (collab.rs)
			sandbox={remote ? "allow-scripts" : undefined}
			title={file}
			width={w}
			height={h}
			style={{ transform: `scale(${s})`, transformOrigin: "0 0", width: w, height: height ? height / s : h }}
			onLoad={() => {
				const win = ref.current?.contentWindow;
				if (!win) return;
				winRef.current = win;
				frames.add(win);
				win.postMessage({ __deck: 1, t: "mode", mode: onWin ? mode : "view" }, "*");
				onWin?.(win);
			}}
		/>
	);
}

/** 무대 슬라이드 — 쪽을 넘기거나 다시 그릴 때 새 iframe 을 옛 것 밑에서 읽고, 다 그려진 뒤에 옛 것을 걷는다.
 *  iframe 하나를 바로 갈아 끼우면 새 문서가 그려지기 전의 빈 흰 바탕이 매번 번쩍인다.
 *  읽는 중에 또 넘기면 읽던 것은 버리고 마지막 쪽만 읽는다 — 보이는 것은 끝까지 옛 쪽이다 */
type Layer = { k: string; file: string; rev: number; revHash?: string };
function SwapFrame({ file, rev, revHash, onWin, ...size }: { file: string; rev: number; revHash?: string; width: number; w: number; h: number; onWin: (win: Window) => void }) {
	const cur: Layer = { k: `${file}|${rev}|${revHash || ""}`, file, rev, revHash };
	const [shown, setShown] = useState<Layer | null>(null);
	const latest = useRef(cur.k);
	latest.current = cur.k;
	const layers = shown && shown.k !== cur.k ? [cur, shown] : [cur];
	return (
		<>
			{layers.map((l) => {
				const top = l !== cur;
				return (
					<div key={l.k} style={{ position: "absolute", left: 0, top: 0, zIndex: top ? 1 : 0 }}>
						<SlideFrame file={l.file} rev={l.rev} revHash={l.revHash} {...size}
							onWin={top ? undefined : (win) => {
								if (!win) return; // 걷히는 옛 창이 null 을 알려도 지금 창을 지우지 않는다
								onWin(win);
								// load 직후는 아직 첫 그림이 화면에 안 올라왔을 수 있어 두 프레임 기다린다. 그 사이 또 넘겼으면 이 쪽은 버린다
								requestAnimationFrame(() => requestAnimationFrame(() => { if (latest.current === l.k) setShown(l); }));
							}} />
					</div>
				);
			})}
		</>
	);
}

/** 쪽 넘김 키 —앱 화면에서 누른 것도, 슬라이드 창이 넘겨준 것(rt.js key)도 여기서 처리한다. 처리했으면 true.
 *  슬라이드 안에서 요소를 고른 동안의 방향키는 rt.js 가 그 요소를 옮기는 데 쓰고 여기로 넘기지 않는다 */
function navKey(key: string): boolean {
	const st = useDeck.getState();
	const n = st.deck?.slides.length || 1;
	if (key === "ArrowDown" || key === "PageDown" || key === "ArrowRight") st.setCurrent(st.current + 1);
	else if (key === "ArrowUp" || key === "PageUp" || key === "ArrowLeft") st.setCurrent(st.current - 1);
	else if (key === "Home") st.setCurrent(0);
	else if (key === "End") st.setCurrent(n - 1);
	else return false;
	return true;
}

/** 휠로 쪽 넘기기 — 한 칸 굴림(≈100)이나 터치패드로 조금씩 민 양이 모이면 한 쪽 넘기고, 잠깐 쉰다.
 *  쉬지 않으면 터치패드 관성 한 번에 열 쪽씩 날아간다 */
function useWheelNav() {
	const acc = useRef(0);
	const until = useRef(0);
	return useCallback((dy: number) => {
		const now = performance.now();
		if (now < until.current) return;
		acc.current += dy;
		if (Math.abs(acc.current) < 60) return;
		const st = useDeck.getState();
		st.setCurrent(st.current + (acc.current > 0 ? 1 : -1));
		acc.current = 0;
		until.current = now + 260;
	}, []);
}

/** 쪽을 끌 때 쪽 id 를 싣는다 — 요청칸에 놓으면 @쪽 으로 들어간다 (Talk Composer) */
export const SLIDE_MIME = "application/x-claudeppt-slide";
function dragSlide(e: React.DragEvent, id: string) {
	e.dataTransfer.setData(SLIDE_MIME, id);
	e.dataTransfer.effectAllowed = "copyMove";
}

/** 쪽 하나의 우클릭 항목 — 쪽 목록 · 이어 보기가 같이 쓴다. 빼기는 Delete 키와 같다 */
function slideItems(i: number, n: number, t: ReturnType<typeof useT>): MenuItem[] {
	const st = useDeck.getState();
	return [
		{ label: t("mention"), kbd: `@${i + 1}`, run: () => st.mentionSlide(i + 1) },
		"-",
		{ label: t("insertAbove"), run: () => st.addSlide(i) },
		{ label: t("insertBelow"), run: () => st.addSlide(i + 1) },
		{ label: t("duplicate"), run: () => st.duplicateSlide(i) },
		"-",
		{ label: t("moveUp"), run: () => st.moveSlide(i, i - 1), disabled: i === 0 },
		{ label: t("moveDown"), run: () => st.moveSlide(i, i + 2), disabled: i >= n - 1 },
		"-",
		{ label: t("removeSlide"), kbd: "Delete", danger: true, run: () => st.removeSlide(i), disabled: n < 2 },
	];
}

/** 지난 판을 보는 동안의 우클릭 — 지난 판의 쪽은 고칠 수 없으니 돌아가거나 되돌리는 것만 둔다 */
function previewItems(t: ReturnType<typeof useT>): MenuItem[] {
	const st = useDeck.getState();
	const p = st.preview;
	return p ? [
		{ label: t("backToNow"), run: () => st.setPreview(null) },
		{ label: t("restore"), run: () => st.restore(p), disabled: !!st.running },
	] : [];
}

/** 옆 영역 너비 — 이 PC 에만 남긴다(설정 파일에 넣을 만한 값이 아니다). 저장소가 막혀도 기본값으로 그린다 */
function useWidth(key: string, init: number, min: number, max: number) {
	const k = "claudeppt.width." + key;
	const [w, setW] = useState(() => {
		try { const v = Number(localStorage.getItem(k)); return v ? Math.min(max, Math.max(min, v)) : init; } catch { return init; }
	});
	const set = useCallback((v: number | null) => {
		const n = v == null ? init : Math.round(Math.min(max, Math.max(min, v)));
		setW(n);
		try { localStorage.setItem(k, String(n)); } catch {}
	}, [k, init, min, max]);
	return [w, set] as const;
}

/** 영역 경계 손잡이 — 끌기 · 화살표 키(Shift 는 크게)로 너비를 바꾸고, 두 번 누르면 기본 너비로 돌린다.
 *  끄는 동안 iframe 이 포인터를 가로채면 손을 놓쳐서 포인터를 손잡이에 붙잡아 둔다. */
function Splitter({ side, at, set, label }: { side: "left" | "right"; at: number; set: (v: number | null) => void; label: string }) {
	const [drag, setDrag] = useState(false);
	const start = useRef({ x: 0, w: 0 });
	const dir = side === "left" ? 1 : -1;
	return (
		<div
			className={"split" + (drag ? " on" : "")}
			style={side === "left" ? { left: at - 3 } : { right: at - 3 }}
			role="separator"
			aria-orientation="vertical"
			aria-label={label}
			aria-valuenow={at}
			tabIndex={0}
			onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start.current = { x: e.clientX, w: at }; setDrag(true); }}
			onPointerMove={(e) => { if (drag) set(start.current.w + (e.clientX - start.current.x) * dir); }}
			onPointerUp={() => setDrag(false)}
			onPointerCancel={() => setDrag(false)}
			onDoubleClick={() => set(null)}
			onKeyDown={(e) => {
				const step = e.shiftKey ? 48 : 12;
				if (e.key === "ArrowLeft") set(at - step * dir);
				else if (e.key === "ArrowRight") set(at + step * dir);
				else if (e.key === "Home" || e.key === "Enter") set(null);
				else return;
				e.preventDefault();
				e.stopPropagation();
			}}
		/>
	);
}

export default function Workspace() {
	const setTool = useDeck((s) => s.setTool);
	const setCurrent = useDeck((s) => s.setCurrent);
	useEffect(() => {
		const k = (e: KeyboardEvent) => {
			const tgt = e.target as Element;
			if (tgt.closest?.("input, textarea, [contenteditable]") || e.ctrlKey || e.altKey || e.metaKey) return;
			const key = e.key.toLowerCase();
			// V 고르기 · 1 2 3 긋는 도구 (P 는 예전 「핀」 모드 손버릇 — 펜으로)
			if (key === "v" || key === "e") setTool("select");
			else if (key === "p" || key === "1") setTool("pen");
			else if (key === "2") setTool("arrow");
			else if (key === "3") setTool("box");
			else if (key === "4") setTool("sketch");
			else if (key === "c") { const st = useDeck.getState(); if (st.vdiff) st.closeCompare(); else st.startCompare(); }
			else if (key === "s") { const st = useDeck.getState(); st.setFlow(!st.flow); }
			else if (!navKey(e.key)) {
				if (e.key === "Escape") { if (useDeck.getState().vdiff) useDeck.getState().closeCompare(); else setTool("select"); }
				else return;
			}
			e.preventDefault();
		};
		addEventListener("keydown", k);
		return () => removeEventListener("keydown", k);
	}, [setTool, setCurrent]);
	const t = useT();
	const [railW, setRailW] = useWidth("rail", 148, 96, 280);
	const [talkW, setTalkW] = useWidth("talk", 384, 300, 720);
	// 대화를 접으면 등뼈 폭만 남는다 — 무대가 그만큼 넓어진다. 펼 때는 접기 전 너비로
	const folded = useTalkFold((s) => s.folded);
	const sideW = folded ? 44 : talkW;
	return (
		<main className="work" style={{ gridTemplateColumns: `${railW}px minmax(0, 1fr) ${sideW}px` }}>
			<Rail />
			<Stage />
			<Talk />
			{/* 무대는 360px 아래로 줄이지 않는다 — 옆 영역을 넓혀도 슬라이드가 보여야 한다 */}
			<Splitter side="left" at={railW} set={(v) => setRailW(v == null ? v : Math.min(v, innerWidth - sideW - 360))} label={t("slides")} />
			{!folded && <Splitter side="right" at={talkW} set={(v) => setTalkW(v == null ? v : Math.min(v, innerWidth - railW - 360))} label={t("talk")} />}
		</main>
	);
}

// ── 쪽 목록 ──
function usePreviewDeck(): Deck | null {
	const preview = useDeck((s) => s.preview);
	const id = useDeck((s) => s.id);
	const [d, setD] = useState<Deck | null>(null);
	useEffect(() => {
		if (!preview) return setD(null);
		fetch(deckUrl(id, "deck.json", preview.hash)).then((r) => r.json()).then(setD, () => setD(null));
	}, [preview, id]);
	return d;
}

function Rail() {
	const t = useT();
	const live = useDeck((s) => s.deck)!;
	const preview = useDeck((s) => s.preview);
	const past = usePreviewDeck();
	const deck = preview && past ? past : live;
	const rev = useDeck((s) => s.rev);
	const current = useDeck((s) => s.current);
	const setCurrent = useDeck((s) => s.setCurrent);
	const pins = useDeck((s) => s.pins);
	// 마지막 턴의 도구 목록만 — 글자가 흐르는 동안(답만 바뀜) 쪽 목록이 다시 그려지지 않게
	const lastTools = useDeck((s) => s.turns[s.turns.length - 1]?.tools);
	const vdiff = useDeck((s) => s.vdiff);
	const mentionSlide = useDeck((s) => s.mentionSlide);
	const move = useDeck((s) => s.moveSlide);
	const addSlide = useDeck((s) => s.addSlide);
	const removeSlide = useDeck((s) => s.removeSlide);
	const [drag, setDrag] = useState<number | null>(null);
	const [dropAt, setDropAt] = useState<number | null>(null);
	const lastFiles = useMemo(() => new Set(lastTools?.map((x) => x.file).filter(Boolean)), [lastTools]);
	const listRef = useRef<HTMLDivElement>(null);
	useEffect(() => { listRef.current?.querySelectorAll(".rail-item")[current]?.scrollIntoView({ block: "nearest" }); }, [current]);

	return (
		<nav className="rail" ref={listRef} aria-label={t("slides")}
			onKeyDown={(e) => {
				if (e.key === "Delete" && !preview) removeSlide(current);
			}}>
			{deck.slides.map((sl, i) => {
				const n = pins.filter((p) => p.slide === sl.id && !p.done).length;
				// 비교 차이는 숫자 대신 미리보기 테두리로 — 숫자는 비교 렌즈를 켰을 때만. 0.1% 차이에 모든 쪽이 빨간 글자로 칠해지면 무엇이 급한지 안 보인다
				// 판 비교 중이면 고른 판과 다른 쪽에 점선 테두리 · 그 뒤에 생긴 쪽에 「새」 — 바뀐 쪽만 골라 넘겨 볼 수 있게
				const vs = !preview ? vdiff?.slides[sl.id] : undefined;
				return (
					<div key={sl.id} className={"rail-item" + (i === current ? " on" : "") + (dropAt === i ? " drop-before" : "") + (vs ? " drift" : "")}
						onDragOver={(e) => { if (drag != null) { e.preventDefault(); setDropAt(i); } }}
						onDrop={() => { if (drag != null) move(drag, i); setDrag(null); setDropAt(null); }}
						// 누른 쪽을 지금 쪽으로 — PowerPoint 처럼 메뉴가 가리키는 쪽이 무대에 보인다
						onContextMenu={(e) => { setCurrent(i); openMenu(e, preview ? previewItems(t) : slideItems(i, live.slides.length, t)); }}>
						<div className="no">
							<span>{i + 1}</span>
							{n > 0 && <span className="pins" title={`${t("pins")} ${n}`} />}
							{vs && <span className="drift">{vs === "added" ? t("vsAdded") : t("vsChangedOne")}</span>}
							<SlideFaces slideId={sl.id} />
							{!preview && <button className="at" onClick={() => mentionSlide(i + 1)} title={`${t("mention")} (@${i + 1})`} aria-label={`${t("mention")} @${i + 1}`}>@</button>}
						</div>
						<button className="thumb" draggable={!preview} onDragStart={(e) => { setDrag(i); dragSlide(e, sl.id); }} onDragEnd={() => { setDrag(null); setDropAt(null); }}
							onClick={() => setCurrent(i)} title={[sl.title || `${i + 1}`, vs && vdiff ? `v${vdiff.base.n} ${vs === "added" ? t("vsAdded") : t("vsChangedOne")}` : "", lastFiles.has(sl.file) ? t("changed") : ""].filter(Boolean).join(" · ")} aria-current={i === current}>
							<ThumbFrame file={sl.file} rev={rev[sl.id] || 0} w={deck.size.w} h={deck.size.h} revHash={preview?.hash} />
							{lastFiles.has(sl.file) && !preview && <span className="fresh" aria-label={t("changed")} />}
						</button>
						{/* 쪽 사이 틈에 손을 대면 「+」 줄이 뜬다 — 끝에만 있는 빈 쪽 상자보다 원하는 자리에 바로 끼운다 */}
						{!preview && <button className="rail-ins" onClick={() => addSlide(i + 1)} title={t("addSlide")} aria-label={`${t("addSlide")} (${i + 1} ↓)`}><i /></button>}
					</div>
				);
			})}
			{!preview && (
				<div className="rail-end" onDragOver={(e) => { if (drag != null) { e.preventDefault(); setDropAt(deck.slides.length); } }} onDrop={() => { if (drag != null) move(drag, deck.slides.length); setDrag(null); setDropAt(null); }}>
					<button onClick={() => addSlide(deck.slides.length)}>+ {t("addSlide")}</button>
				</div>
			)}
		</nav>
	);
}

/** 쪽 목록 미리보기는 목록에서 보이는 언저리(위아래 한 화면쯤)에 있을 때만 iframe 을 띄운다.
 *  쪽마다 늘 띄우면 큰 덱(수백 쪽 · 큰 그림)을 여는 순간 iframe 이 쪽 수만큼 원본 크기로 그림을 읽어 웹뷰가 버벅이거나 멈춘다.
 *  멀어지면 내린다 — 다시 오면 그때 새로 읽는다. 내보내기 · 비교 검사는 화면 밖 틀(offscreen)을 따로 쓰므로 이것과 무관하다. */
function ThumbFrame(p: { file: string; rev: number; w: number; h: number; revHash?: string }) {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	const [near, setNear] = useState(false);
	useLayoutEffect(() => {
		const el = ref.current!;
		const ro = new ResizeObserver(() => setWidth(el.clientWidth));
		ro.observe(el);
		const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root: el.closest(".rail"), rootMargin: "100% 0px" });
		io.observe(el);
		return () => { ro.disconnect(); io.disconnect(); };
	}, []);
	return <div ref={ref} style={{ position: "absolute", inset: 0 }}>{near && width > 0 && <SlideFrame {...p} width={width} />}</div>;
}

// ── 무대 ──
function Stage() {
	const t = useT();
	const live = useDeck((s) => s.deck)!;
	const preview = useDeck((s) => s.preview);
	const past = usePreviewDeck();
	const deck = preview && past ? past : live;
	const current = useDeck((s) => s.current);
	const mode = useDeck((s) => s.mode);
	const rev = useDeck((s) => s.rev);
	const pins = useDeck((s) => s.pins);
	const applyDirect = useDeck((s) => s.applyDirect);
	const restore = useDeck((s) => s.restore);
	const setPreview = useDeck((s) => s.setPreview);
	const compare = useDeck((s) => !!s.vdiff && !s.preview);
	const flowOn = useDeck((s) => s.flow);
	const setFlow = useDeck((s) => s.setFlow);
	const tool = useDeck((s) => s.tool);
	const setTool = useDeck((s) => s.setTool);
	// 비교 렌즈는 한 쪽 무대에만 있다 — 비교 중에는 이어 보기를 잠시 접는다
	const flow = flowOn && !compare;
	const wheel = useWheelNav();
	const canvas = useRef<HTMLDivElement>(null);
	const [box, setBox] = useState({ w: 0, h: 0 });
	const [active, setActive] = useState<string | null>(null);
	const win = useRef<Window | null>(null);
	const slide = deck.slides[Math.min(current, deck.slides.length - 1)];

	useLayoutEffect(() => {
		const el = canvas.current!;
		const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	const pad = 36;
	const scale = Math.max(0.05, Math.min((box.w - pad * 2) / deck.size.w, (box.h - pad * 2) / deck.size.h));
	const left = (box.w - deck.size.w * scale) / 2, top = (box.h - deck.size.h * scale) / 2;

	// 직접 편집 — 무대 iframe 이 보낸 것만 받는다
	useEffect(() => onFrame((m, src) => {
		if (src !== win.current || !slide) return;
		// 슬라이드 창 위에서 굴린 휠 · 누른 넘김 키 (rt.js 가 넘겨준다)
		if (m.t === "wheel") return wheel(m.dy);
		if (m.t === "key") return void navKey(m.key);
		if (preview) return;
		if (m.t === "undo") return void useDeck.getState().undo();
		if (m.t === "redo") return void useDeck.getState().redo();
		if (m.t === "edit") applyDirect(slide.id, m.path, { t: "edit", html: m.html });
		else if (m.t === "patch") applyDirect(slide.id, m.path, { t: "patch", style: m.style });
		else if (m.t === "remove") applyDirect(slide.id, m.path, { t: "remove" });
	}), [slide?.id, preview]);

	/** 슬라이드 (x, y) 에 핀을 꽂고 의견 칸을 연다. 표시면 그 모양도 함께. 그 자리(표시면 가운데) 요소는 슬라이드 창에 물어 붙인다 */
	const pinAt = async (x: number, y: number, shape?: Shape) => {
		if (!slide) return;
		setActive(await placePin(slide.id, win.current, x, y, shape));
	};
	const onMark = (s: Shape) => markToPin(s, pinAt);
	// 긋는 도구일 때 Ctrl+Z 는 이 쪽의 마지막 표시 지우기 (도구 고르기 키는 Workspace 에 있다)
	useEffect(() => {
		// 스케치 판은 제 Ctrl+Z(마지막 획 지우기)를 쓴다
		if (mode !== "pin" || preview || tool === "sketch") return;
		const k = (e: KeyboardEvent) => {
			if ((e.target as Element).closest?.("input, textarea, [contenteditable]")) return;
			if (e.ctrlKey && e.key.toLowerCase() === "z") { undoMark(); e.preventDefault(); }
		};
		addEventListener("keydown", k);
		return () => removeEventListener("keydown", k);
	}, [mode, preview, slide?.id, tool]);
	const undoMark = () => {
		const st = useDeck.getState();
		const last = st.pins.filter((p) => p.slide === slide?.id).sort((a, b) => b.at - a.at)[0];
		if (last) { st.removePin(last.id); setActive(null); }
	};

	// 무대 우클릭 — 슬라이드 창 안에서 누른 것은 frames.ts 가 다시 쏴 준다(__deck 에 창이 잰 자리 · 요소)
	const stageMenu = (e: React.MouseEvent) => {
		if (!slide) return;
		if (preview) return openMenu(e, previewItems(t));
		const st = useDeck.getState();
		const hit = (e.nativeEvent as MouseEvent & { __deck?: { x: number; y: number; path: number[] | null; tag: string; text: string } }).__deck;
		let at = hit ? { x: hit.x, y: hit.y } : null;
		const sheet = !flow && canvas.current?.querySelector(".sheet");
		if (!at && sheet) {
			const r = sheet.getBoundingClientRect();
			const x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
			if (x >= 0 && y >= 0 && x <= deck.size.w && y <= deck.size.h) at = { x, y };
		}
		const i = current, n = deck.slides.length;
		openMenu(e, [
			{ label: t("mention"), kbd: `@${i + 1}`, run: () => st.mentionSlide(i + 1) },
			...(at && !flow && !compare ? [{ label: t("pinHere"), run: () => pinAt(at.x, at.y) }] : []),
			...(mode === "edit" && hit?.path?.length ? [{ label: `${t("removeEl")} <${hit.tag}>`, kbd: "Delete", danger: true, run: () => applyDirect(slide.id, hit.path, { t: "remove" }) }] : []),
			"-",
			{ label: t("toolSelect"), kbd: "V", checked: tool === "select", run: () => setTool("select") },
			{ label: t("toolPen"), kbd: "1", checked: tool === "pen", run: () => setTool("pen") },
			{ label: t("toolArrow"), kbd: "2", checked: tool === "arrow", run: () => setTool("arrow") },
			{ label: t("toolBox"), kbd: "3", checked: tool === "box", run: () => setTool("box") },
			{ label: t("sketch"), kbd: "4", checked: tool === "sketch", run: () => setTool("sketch") },
			{ label: t("flow"), kbd: "S", checked: flowOn, run: () => setFlow(!flowOn) },
			{ label: t("compare"), kbd: "C", checked: !!st.vdiff, run: () => (st.vdiff ? st.closeCompare() : st.startCompare()), disabled: st.versions.length < 2 },
			"-",
			{ label: t("duplicate"), run: () => st.duplicateSlide(i) },
			{ label: t("removeSlide"), danger: true, run: () => st.removeSlide(i), disabled: n < 2 },
		]);
	};

	if (!slide) return <section className="stage" />;
	const mine = pins.filter((p) => p.slide === slide.id);

	return (
		<section className="stage" data-mode={preview ? "view" : mode} aria-label={t("slides")}>
			<div className="stage-banner">
				<StageFaces slideId={slide.id} />
				<EditingNote slideId={slide.id} />
				{compare && <VersionBar slideId={slide.id} />}
				{preview && (
					<div className="past" role="status">
						<span className="node">v{preview.n}</span>
						<span style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>{preview.subject}</span>
						<span className="dim mono">{preview.date}</span>
						<button className="primary" onClick={() => restore(preview)}>{t("restore")}</button>
						<button onClick={() => useDeck.getState().startCompare(preview)}>{t("compareWith")}</button>
						<button onClick={() => useDeck.getState().mentionVersion(preview.n)} title={t("mentionVersionHint")}>@v{preview.n}</button>
						<button onClick={() => setPreview(null)}>{t("backToNow")}</button>
					</div>
				)}
			</div>
			<div className="canvas" ref={canvas} onWheel={flow ? undefined : (e) => wheel(e.deltaY)} onContextMenu={stageMenu}>
				{flow ? <Flow deck={deck} revHash={preview?.hash} /> : box.w > 0 && (
					<div className="sheet" style={{ left, top, width: deck.size.w * scale, height: deck.size.h * scale }}>
						<div style={{ width: deck.size.w * scale, height: deck.size.h * scale, overflow: "hidden", position: "relative" }}>
							<div style={{ position: "absolute", left: 0, top: 0 }}>
								<SwapFrame file={slide.file} rev={rev[slide.id] || 0} w={deck.size.w} h={deck.size.h} width={deck.size.w * scale} revHash={preview?.hash} onWin={(w) => { win.current = w; }} />
							</div>
						</div>
						{compare && <VersionLens slideId={slide.id} w={deck.size.w} h={deck.size.h} scale={scale} />}
						{!preview && !compare && (
							<SlideMarks slideId={slide.id} w={deck.size.w} h={deck.size.h} scale={scale} drawing={mode === "pin" && tool !== "sketch"} active={active} setActive={setActive} onMark={onMark} />
						)}
						{!preview && !compare && tool === "sketch" && <SketchBoard slideId={slide.id} w={deck.size.w} h={deck.size.h} scale={scale} room={box.h - top - deck.size.h * scale} />}
					</div>
				)}
			</div>
			{!preview && box.w > 0 && (flow
				// 이어 보기에서는 띠를 무대 위쪽에 띄워 둔다 — 첫 쪽 위 여백(FLOW_PAD)에 들어가고, 스크롤해도 그 자리에 남는다
				? <StageTools left={(box.w - flowWidth(box.w, deck)) / 2} top={52} right={(box.w + flowWidth(box.w, deck)) / 2} onUndo={undoMark} canUndo={mine.length > 0} />
				: <StageTools left={left} top={top} right={left + deck.size.w * scale} onUndo={undoMark} canUndo={mine.length > 0} />)}
		</section>
	);
}

// ── 표시 ──
/** 그 쪽 (x, y) 에 핀을 꽂고 id 를 돌려준다. 표시면 그 모양도 함께. 그 자리(표시면 가운데) 요소는 슬라이드 창에 물어 붙인다 */
async function placePin(slideId: string, win: Window | null, x: number, y: number, shape?: Shape) {
	let target: Pin["target"];
	const b = shape && bbox(shape);
	try {
		if (win) {
			const hit: any = await ask(win, { t: "hit", x: b ? (b.x0 + b.x1) / 2 : x, y: b ? (b.y0 + b.y1) / 2 : y }, 1500);
			target = { tag: hit.tag, text: hit.text, path: hit.path };
		}
	} catch {}
	return useDeck.getState().addPin({ slide: slideId, x, y, text: "", target, shape });
}

/** 긋기를 마쳤다 — 거의 안 움직였으면 누른 것으로 보고 핀, 아니면 표시 */
function markToPin(s: Shape, pinAt: (x: number, y: number, shape?: Shape) => void) {
	if (tiny(s)) return pinAt(s.pts[0], s.pts[1]);
	const a = anchor(s);
	pinAt(a.x, a.y, s);
}

/** 한 쪽 위의 표시 · 핀 층. 한 쪽 보기와 이어 보기가 같이 쓴다 — 핀 번호는 덱 전체에서 꽂은 차례다 */
function SlideMarks({ slideId, w, h, scale, drawing, active, setActive, onMark }: { slideId: string; w: number; h: number; scale: number; drawing: boolean; active: string | null; setActive: (id: string | null) => void; onMark: (s: Shape) => void }) {
	const pins = useDeck((s) => s.pins);
	// 해결된 의견은 감춘다 (의견 목록의 「해결됨」에서 다시 연다)
	const mine = pins.filter((p) => p.slide === slideId && !p.done);
	return (
		<div className="overlay">
			<MarkLayer marks={mine} w={w} h={h} scale={scale} drawing={drawing} active={active} onMark={onMark} />
			{mine.map((p) => (
				<PinMark key={p.id} pin={p} n={pins.indexOf(p) + 1} scale={scale} flip={p.x * scale > w * scale - 290} open={active === p.id} onOpen={() => setActive(active === p.id ? null : p.id)} onClose={() => setActive(null)} />
			))}
		</div>
	);
}

/** 그어 놓은 표시와 지금 긋는 표시. drawing 이면 누르기 · 끌기를 받는다 — 펜은 지난 길을, 화살표 · 상자는 시작점에서 지금 자리까지.
 *  그리는 동안의 점은 이 층 안 상태로만 들고 있다 — 무대 전체를 다시 그리면 슬라이드 iframe 까지 흔들린다 */
function MarkLayer({ marks, w, h, scale, drawing, active, onMark }: { marks: Pin[]; w: number; h: number; scale: number; drawing: boolean; active: string | null; onMark: (s: Shape) => void }) {
	const tool = useDeck((s) => s.tool);
	const [draft, setDraft] = useState<Shape | null>(null);
	const at = (e: React.PointerEvent) => {
		const r = (e.currentTarget as Element).getBoundingClientRect();
		return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
	};
	return (
		<svg className={"marks" + (drawing ? " drawing" : "")} data-tool={tool} width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`}
			onPointerDown={drawing ? (e) => {
				if (e.button !== 0) return;
				e.currentTarget.setPointerCapture(e.pointerId);
				const [x, y] = at(e);
				setDraft({ kind: tool as Tool, pts: tool === "pen" ? [x, y] : [x, y, x, y] });
			} : undefined}
			onPointerMove={draft ? (e) => {
				const [x, y] = at(e);
				const p = draft.pts;
				// 펜은 2px 넘게 움직였을 때만 점을 더한다 — 점이 너무 많으면 곡선이 떨린다
				if (draft.kind === "pen") { if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) > 2 / scale) setDraft({ ...draft, pts: [...p, x, y] }); }
				else setDraft({ ...draft, pts: [p[0], p[1], x, y] });
			} : undefined}
			onPointerUp={draft ? () => { onMark(draft); setDraft(null); } : undefined}
			onPointerCancel={() => setDraft(null)}>
			{marks.filter((p) => p.shape).map((p) => (
				<path key={p.id} d={shapePath(p.shape!)} className={(p.text ? "" : "draft") + (active === p.id ? " on" : "")} stroke={MARK} />
			))}
			{draft && !tiny(draft) && <path d={shapePath(draft)} className="live" stroke={MARK} />}
		</svg>
	);
}

/** 무대 도구 띠 — 슬라이드 위 가장자리에 붙는다. 왼쪽은 도구(고르기 · 펜 · 화살표 · 상자), 오른쪽은 판 비교.
 *  슬라이드에서 손이 멀리 가지 않고, 옆 여백(36px)보다 넓은 위아래 여백을 쓴다 */
function StageTools({ left, top, right, onUndo, canUndo }: { left: number; top: number; right: number; onUndo: () => void; canUndo: boolean }) {
	const t = useT();
	const tool = useDeck((s) => s.tool);
	const setTool = useDeck((s) => s.setTool);
	const compare = useDeck((s) => !!s.vdiff);
	const canCompare = useDeck((s) => s.versions.length > 1);
	const busy = useDeck((s) => !!s.busy);
	const y = top > 50 ? top - 44 : top + 8;
	const tools: { k: Tool | "select" | "sketch"; key: string; label: string; icon: React.ReactNode }[] = [
		{ k: "select", key: "V", label: t("toolSelect"), icon: <path d="M3.5 2.5l9 5-4 1.2-1.6 4.3z" /> },
		{ k: "pen", key: "1", label: t("toolPen"), icon: <path d="M2.5 11.5c2-4 3.5-6 5-6s.5 4 2 4 2-3 4-6" /> },
		{ k: "arrow", key: "2", label: t("toolArrow"), icon: <path d="M3 13L13 3M7 3h6v6" /> },
		{ k: "box", key: "3", label: t("toolBox"), icon: <rect x="2.5" y="4" width="11" height="8" rx="1" /> },
		{ k: "sketch", key: "4", label: t("sketch"), icon: <><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M4.5 6h4M4.5 9h7" /></> },
	];
	// 위 여백이 좁으면(창이 낮을 때) 슬라이드 안쪽 위에 겹쳐 둔다
	return (
		<>
			<div className="stagetools" role="toolbar" aria-label={t("tools")} style={{ left, top: y }}>
				{tools.map((x) => (
					<button key={x.k} aria-pressed={tool === x.k} onClick={() => setTool(x.k)} title={`${x.label} (${x.key}). ${x.k === "select" ? t("selectHint") : x.k === "sketch" ? t("sketchHint") : t("toolHint")}`} aria-label={x.label}>
						<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>{x.icon}</svg>
					</button>
				))}
				{tool !== "select" && tool !== "sketch" && (
					<>
						<i />
						<button onClick={onUndo} disabled={!canUndo} title={`${t("undoMark")} (Ctrl+Z)`} aria-label={t("undoMark")}>
							<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M5 3L2 6l3 3M2.5 6H10a3.5 3.5 0 010 7H6" /></svg>
						</button>
					</>
				)}
				<span className="hint" key={tool}>{tool === "select" ? t("selectHint") : tool === "sketch" ? t("sketchHint") : t("toolHint")}</span>
			</div>
			{/* 비교 — 직전 판과 지금을 견준다. 다른 판은 띠의 판 고르기 · 판 목록에서 (C) */}
			<button className={"stagecheck" + (compare ? " on" : "")} style={{ right: `calc(100% - ${right}px)`, top: y }} disabled={busy || !canCompare}
				onClick={() => { const st = useDeck.getState(); if (st.vdiff) st.closeCompare(); else st.startCompare(); }} title={`${t("compareHint")} (C)`}>
				{t("compare")}<kbd>C</kbd>
			</button>
		</>
	);
}

// ── 이어 보기 ──
// 위 여백은 오른쪽 위 「한 쪽 · 이어 보기」 단추에 첫 쪽이 가리지 않을 만큼
const FLOW_PAD = 56, FLOW_SIDE = 40, FLOW_GAP = 28;
/** 이어 보기의 쪽 너비 — 무대 도구 띠도 이 너비에 맞춰 놓는다 */
const flowWidth = (boxW: number, deck: Deck) => Math.max(160, Math.min(boxW - FLOW_SIDE * 2, deck.size.w));

/** 모든 쪽을 세로로 늘어놓는다. 스크롤해서 화면 가운데에 온 쪽이 지금 쪽이 되고, 쪽 목록 · 방향키로 지금 쪽을 바꾸면 그 쪽으로 스크롤한다.
 *  쪽은 화면 언저리에 올 때만 띄운다(ThumbFrame 과 같은 까닭 — 큰 덱에서 iframe 수십 개를 한꺼번에 띄우면 웹뷰가 멈춘다).
 *  누르면 그 쪽이 지금 쪽, 두 번 누르면 한 쪽 보기로 그 쪽을 크게 연다.
 *  펜 · 화살표 · 범위는 여기서도 쪽마다 긋는다(SlideMarks). 글자 고치기 · 끌어 옮기기는 한 쪽 보기에서 한다 */
function Flow({ deck, revHash }: { deck: Deck; revHash?: string }) {
	const t = useT();
	const current = useDeck((s) => s.current);
	const setCurrent = useDeck((s) => s.setCurrent);
	const setFlow = useDeck((s) => s.setFlow);
	const rev = useDeck((s) => s.rev);
	const pins = useDeck((s) => s.pins);
	const mode = useDeck((s) => s.mode);
	const drawing = mode === "pin" && !revHash;
	const ref = useRef<HTMLDivElement>(null);
	const [box, setBox] = useState({ w: 0, h: 0 });
	const [active, setActive] = useState<string | null>(null);
	// 쪽마다의 슬라이드 창 — 핀을 꽂을 때 그 자리 요소를 묻는다
	const wins = useRef(new Map<string, Window>());
	// 스크롤이 바꾼 지금 쪽이면 다시 스크롤하지 않는다 — 안 그러면 스크롤과 맞춤이 서로를 끌어당긴다
	const fromScroll = useRef(false);
	const first = useRef(true);
	// 앱이 지금 쪽으로 스크롤해 가는 중이면 그 목적지(px). 가는 길에 지나는 쪽을 지금 쪽으로 잡지 않는다 — 안 그러면 중간 쪽에서 멈춘다.
	// 사용자가 도중에 휠을 굴리면 목적지에 닿지 않으므로 잠시 뒤 놓아준다
	const aim = useRef<{ y: number; until: number } | null>(null);
	useLayoutEffect(() => {
		const el = ref.current!;
		const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	const width = flowWidth(box.w, deck);
	const height = (width * deck.size.h) / deck.size.w;
	const step = height + FLOW_GAP;
	const topOf = (i: number) => FLOW_PAD + i * step;

	useEffect(() => {
		const el = ref.current;
		if (!el || !box.w) return;
		if (fromScroll.current) { fromScroll.current = false; return; }
		const y = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, topOf(current) - Math.max(FLOW_PAD, (el.clientHeight - height) / 2)));
		if (Math.abs(el.scrollTop - y) < 2) return;
		aim.current = { y, until: performance.now() + 1500 };
		el.scrollTo({ top: y, behavior: first.current ? "auto" : "smooth" });
		first.current = false;
	}, [current, box.w, height]);

	const onScroll = () => {
		const el = ref.current!;
		if (aim.current) {
			if (Math.abs(el.scrollTop - aim.current.y) >= 2 && performance.now() < aim.current.until) return;
			aim.current = null;
		}
		const mid = el.scrollTop + el.clientHeight / 2;
		const i = Math.max(0, Math.min(deck.slides.length - 1, Math.floor((mid - FLOW_PAD + FLOW_GAP / 2) / step)));
		if (i !== useDeck.getState().current) { fromScroll.current = true; setCurrent(i); }
	};

	return (
		<div className="flow" ref={ref} onScroll={onScroll}>
			{box.w > 0 && (
				<div style={{ position: "relative", height: topOf(deck.slides.length) - FLOW_GAP + FLOW_PAD }}>
					{deck.slides.map((sl, i) => {
						const n = pins.filter((p) => p.slide === sl.id).length;
						return (
							<div key={sl.id} className={"flow-item" + (i === current ? " on" : "")} style={{ top: topOf(i), left: (box.w - width) / 2, width, height }}
								draggable={!revHash && !drawing} onDragStart={(e) => dragSlide(e, sl.id)}
								onClick={() => setCurrent(i)} onDoubleClick={() => { if (drawing) return; setCurrent(i); setFlow(false); }}
								onContextMenu={(e) => {
									setCurrent(i);
									if (revHash) return openMenu(e, previewItems(t));
									openMenu(e, [{ label: t("openSingle"), run: () => setFlow(false) }, "-", ...slideItems(i, deck.slides.length, t)]);
								}}>
								<span className="flow-no mono">{i + 1}{n > 0 && <i title={`${t("pins")} ${n}`} />}</span>
								<FlowFrame file={sl.file} rev={rev[sl.id] || 0} w={deck.size.w} h={deck.size.h} width={width} revHash={revHash}
									onWin={(w) => { if (w) wins.current.set(sl.id, w); else wins.current.delete(sl.id); }} />
								{!revHash && (
									<SlideMarks slideId={sl.id} w={deck.size.w} h={deck.size.h} scale={width / deck.size.w} drawing={drawing} active={active} setActive={setActive}
										onMark={(s) => markToPin(s, async (x, y, shape) => {
											fromScroll.current = true;
											setCurrent(i);
											setActive(await placePin(sl.id, wins.current.get(sl.id) || null, x, y, shape));
										})} />
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function FlowFrame(p: { file: string; rev: number; w: number; h: number; width: number; revHash?: string; onWin?: (win: Window | null) => void }) {
	const ref = useRef<HTMLDivElement>(null);
	const [near, setNear] = useState(false);
	useLayoutEffect(() => {
		const el = ref.current!;
		const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root: el.closest(".flow"), rootMargin: "100% 0px" });
		io.observe(el);
		return () => io.disconnect();
	}, []);
	// 쪽 위의 덮개 — 누름 · 두 번 누름을 iframe 이 삼키지 않게 한다. 휠은 덮개를 지나 스크롤 상자로 간다
	return <div ref={ref} className="flow-sheet">{near && <SlideFrame {...p} />}<div className="flow-cover" /></div>;
}

function PinMark({ pin, n, scale, flip, open, onOpen, onClose }: { pin: Pin; n: number; scale: number; flip: boolean; open: boolean; onOpen: () => void; onClose: () => void }) {
	const t = useT();
	const update = useDeck((s) => s.updatePin);
	const remove = useDeck((s) => s.removePin);
	const meName = useSettings((x) => x.s.me).trim();
	// 다른 사람의 의견 — 고치지 않고 읽는다. 해결하거나 이 쪽 세션에 보낼 수 있다
	if (pin.by && pin.by !== meName) {
		return (
			<div className="pinmark other" style={{ left: pin.x * scale, top: pin.y * scale }} onClick={(e) => e.stopPropagation()}>
				<button className="dot" onClick={onOpen} aria-label={`${t("pin")} ${n} · ${pin.by}`} title={pin.by}><span>{n}</span></button>
				{open && (
					<div className="pin-note" style={flip ? { left: "auto", right: 16 } : undefined}>
						<div className="by">{pin.by}</div>
						<p className="txt">{pin.text || "…"}</p>
						<div className="row">
							<span className="at">{pin.target?.text || ""}</span>
							<button onClick={() => { useDeck.getState().resolvePin(pin.id, true); onClose(); }}>{t("resolve")}</button>
							<button onClick={() => { useDeck.getState().sendPin(pin.id); onClose(); }} title={t("pinSendHint")}>{t("pinSendShort")}</button>
						</div>
					</div>
				)}
			</div>
		);
	}
	const [text, setText] = useState(pin.text);
	useEffect(() => setText(pin.text), [pin.text]);
	const commit = () => { if (text !== pin.text) update(pin.id, text); };
	return (
		<div className={"pinmark" + (pin.text ? "" : " draft")} style={{ left: pin.x * scale, top: pin.y * scale }} onClick={(e) => e.stopPropagation()}>
			<button className="dot" onClick={onOpen} aria-label={`${t("pin")} ${n}`}><span>{n}</span></button>
			{open && (
				<div className="pin-note" style={flip ? { left: "auto", right: 16 } : undefined}>
					<textarea autoFocus value={text} placeholder={t("pinPlaceholder")} onChange={(e) => setText(e.target.value)} onBlur={commit}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); onClose(); }
							if (e.key === "Escape") { e.stopPropagation(); commit(); onClose(); }
						}} />
					<div className="row">
						{/* 가리킨 자리의 글 — 좌표 · 태그 이름은 Claude 에게만 간다 */}
						<span className="at">{pin.target?.text || ""}</span>
						<button onClick={() => { remove(pin.id); onClose(); }}>{t("delete")}</button>
					</div>
				</div>
			)}
		</div>
	);
}
