// 서식 띠 — PowerPoint 위쪽 「홈 · 삽입」 도구를 무대 맨 위 한 줄에 둔다.
// 슬라이드 창(rt.js)에 cmd 로 시키고, 고른 것의 서식은 sel 로 받는다. 고친 것은 rt.js 가 patch · append … 로 돌려보내
// 무대(Workspace.tsx Stage)가 원본 HTML 에 되쓴다 — 손 편집과 같은 길이라 Ctrl+Z · 판에 그대로 들어간다.
//
// 목차
//   SelInfo       rt.js 가 알려 주는 고른 것의 서식
//   Ribbon        삽입(글상자 · 도형 · 그림) · 글꼴(크기 · 굵게 · 기울임꼴 · 밑줄 · 색) · 단락(가로 · 세로 맞춤)
//                 · 도형(채우기 · 윤곽선) · 정렬(순서 · 맞춤) · 복제 · 삭제
//   ColorPop      색 고르기 — 테마 색(덱 theme.css 변수) · 표준 색 · 없음 · 다른 색
//   insertImage   그림 파일을 assets/ 에 복사하고 쪽 가운데에 넣는다
//
// 글을 고치는 중에도 쓰는 단추(굵게 · 색 …)는 누를 때 포커스를 뺏지 않는다(onMouseDown preventDefault).
// 뺏으면 고치던 글이 끝나 고른 글자가 풀리고, 고른 글자에만 입히는 굵게 · 색이 글 전체로 간다.
//
// 띠는 처음에 접혀 있다 (2026.11.25 사용자 결정) — 말로만 만드는 사람에게는 무대가 넓은 편이 낫고, 도구가 필요한 사람만
// 무대 도구 띠의 「서식」(F)으로 꺼낸다. 펼침은 이 PC 에만 기억한다. 접어도 슬라이드 안 편집(손잡이 · Ctrl+B · Ctrl+D …)은 그대로다.
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { api, deckUrl } from "../lib/api";
import { IMAGE_EXT } from "../lib/attach";
import { tell } from "../lib/frames";
import { type Key, useT } from "../lib/i18n";
import { useDeck } from "../lib/store";
import { openMenu } from "./ContextMenu";

export interface SelInfo {
	tag: string;
	editing: boolean;
	/** 옮기기 · 크기 · 맞춤을 할 수 있다 (절대 위치 상자, 흐름 배치의 덩이 요소) */
	box: boolean;
	/** 절대 위치 상자 — 앞뒤 순서는 이것만. 흐름 요소의 순서를 바꾸면 겹침이 아니라 배치 차례가 바뀐다 */
	abs: boolean;
	/** flex 상자 — 글 세로 맞춤을 할 수 있다 */
	flex: boolean;
	image: boolean;
	/** 글자 크기 px (쪽 1px = 0.75pt) */
	size: number;
	/** 줄 간격 — 글자 크기의 배수 (normal 이면 null) */
	lh: number | null;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	color: string | null;
	align: string;
	valign: string;
	fill: string | null;
	line: { hex: string | null; w: number } | null;
}

// PowerPoint 글꼴 크기 목록 (pt) — 크게 · 작게가 이 차례로 오르내린다
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];
const STD = ["#000000", "#FFFFFF", "#C00000", "#FF0000", "#FFC000", "#FFFF00", "#92D050", "#00B050", "#00B0F0", "#0070C0", "#002060", "#7030A0"];
// 테마 색 — 덱 theme.css 의 변수. 원본에도 var(--…) 로 쓴다: 테마를 바꾸면 따라 바뀐다
const THEME: [string, Key][] = [["--ink", "rbInk"], ["--accent", "rbAccent"], ["--muted", "rbMuted"], ["--line", "rbLineC"], ["--soft", "rbSoft"], ["--paper", "rbPaper"]];
const WEIGHTS = [1, 2, 3, 4, 6, 8];
// 줄 간격 — PowerPoint 목록과 같은 수
const LINE_HEIGHTS = [1, 1.15, 1.5, 2, 2.5, 3];
const SHOWN_KEY = "claudeppt.ribbon";
export const useRibbon = create<{ shown: boolean; toggle: () => void }>()((set, get) => ({
	shown: (() => { try { return localStorage.getItem(SHOWN_KEY) === "1"; } catch { return false; } })(),
	toggle: () => {
		const shown = !get().shown;
		set({ shown });
		try { localStorage.setItem(SHOWN_KEY, shown ? "1" : "0"); } catch {}
	},
}));

/** 누를 때 포커스를 뺏지 않는다 — 슬라이드 창에서 고치던 글을 살린다 */
const hold = (e: React.MouseEvent) => e.preventDefault();

const Icon = ({ d, children }: { d?: string; children?: React.ReactNode }) => (
	<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>{d ? <path d={d} /> : children}</svg>
);

/** 덱 theme.css 의 :root 변수 — 테마 색 칸을 덱 색으로 칠한다 */
function useThemeVars() {
	const id = useDeck((s) => s.id);
	const theme = useDeck((s) => s.deck?.theme || "theme.css");
	const [vars, setVars] = useState<Record<string, string>>({});
	useEffect(() => {
		if (!id) return;
		fetch(deckUrl(id, theme) + "?t=" + Date.now()).then((r) => r.text()).then((css) => {
			// :root 가 여럿일 수 있다 — 옛 덱은 처음 :root 뒤에 템플릿 구획이 붙는다 (deck.rethemeCss). 뒤의 값이 이긴다
			const v: Record<string, string> = {};
			for (const root of css.matchAll(/:root\s*\{([^}]*)\}/g)) for (const m of root[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) v[m[1]] = m[2].trim();
			setVars(v);
		}, () => setVars({}));
	}, [id, theme]);
	return vars;
}

export function Ribbon({ win, info, placing, off, onAsk }: { win: React.MutableRefObject<Window | null>; info: SelInfo | null; placing: string | null; off: boolean; onAsk?: () => void }) {
	const t = useT();
	const tool = useDeck((s) => s.tool);
	const setTool = useDeck((s) => s.setTool);
	const vars = useThemeVars();
	const send = (cmd: string, v?: unknown) => tell(win.current, { t: "cmd", cmd, v });
	/** 넣기 — 긋는 도구였으면 고르기로 돌린다 (모드가 먼저 가야 슬라이드 창이 명령을 받는다) */
	const insert = (kind: string) => {
		if (tool !== "select") setTool("select");
		send("place", placing === kind ? null : kind);
	};
	// 그리기 대기 중 Esc — 단추를 누른 뒤라 포커스가 앱에 있으면 슬라이드 창이 Esc 를 못 받는다
	useEffect(() => {
		if (!placing) return;
		const k = (e: KeyboardEvent) => { if (e.key === "Escape") { send("place", null); e.stopImmediatePropagation(); } };
		addEventListener("keydown", k, true);
		return () => removeEventListener("keydown", k, true);
	}, [placing]);
	const pt = info ? Math.round(info.size * 0.75 * 10) / 10 : null;
	const [sizeText, setSizeText] = useState("");
	useEffect(() => setSizeText(pt == null ? "" : String(pt)), [pt]);
	const step = (d: 1 | -1) => {
		if (pt == null) return;
		const next = d > 0 ? SIZES.find((s) => s > pt + 0.05) ?? pt + 8 : [...SIZES].reverse().find((s) => s < pt - 0.05) ?? Math.max(1, pt - 1);
		send("size", next);
	};
	const sizeCommit = () => {
		const v = parseFloat(sizeText);
		if (v > 0 && v <= 400 && v !== pt) send("size", v);
		else setSizeText(pt == null ? "" : String(pt));
	};
	const none = !info;
	// 그림을 골랐으면 글꼴 · 단락은 닿을 글이 없다
	const noText = none || !!info?.image;
	const align = info?.align === "start" ? "left" : info?.align === "end" ? "right" : info?.align;

	return (
		<div className={"ribbon" + (off ? " off" : "")} role="toolbar" aria-label={t("rbRibbon")} title={off ? t("rbOff") : undefined}>
			{/* 삽입 */}
			<button aria-pressed={placing === "text"} onClick={() => insert("text")} title={t("rbTextbox")}>
				<Icon><rect x="2.5" y="3" width="11" height="10" rx="1" /><path d="M5.5 6h5M8 6v5" /></Icon>{t("rbTextbox")}
			</button>
			<button aria-pressed={!!placing && placing !== "text"} title={t("rbShape")}
				onClick={(e) => openMenu(e, [
					{ label: t("rbRect"), checked: placing === "rect", run: () => insert("rect") },
					{ label: t("rbRound"), checked: placing === "round", run: () => insert("round") },
					{ label: t("rbEllipse"), checked: placing === "ellipse", run: () => insert("ellipse") },
					{ label: t("rbLine"), checked: placing === "line", run: () => insert("line") },
				])}>
				<Icon><rect x="2" y="2.5" width="7" height="7" rx="1" /><circle cx="10.5" cy="10.5" r="3.5" /></Icon>{t("rbShape")}<Caret />
			</button>
			<button aria-label={t("rbImage")} onClick={() => insertImage(win, t("rbImage"), () => { if (tool !== "select") setTool("select"); })} title={t("rbImage")}>
				<Icon><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M2.5 11.5l3.5-3.5 3 3 2-2 2.5 2.5" /><circle cx="10.5" cy="6" r="1" /></Icon>
			</button>
			<i className="sep" />

			{/* 글꼴 */}
			<input className="size" value={sizeText} disabled={noText} aria-label={t("rbFontSize")} title={t("rbFontSize")} inputMode="decimal"
				onChange={(e) => setSizeText(e.target.value)} onBlur={sizeCommit}
				onKeyDown={(e) => { if (e.key === "Enter") { sizeCommit(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setSizeText(pt == null ? "" : String(pt)); }} />
			<button className="rb-sizes" disabled={noText} title={t("rbFontSize")} aria-label={t("rbFontSize")}
				onClick={(e) => openMenu(e, SIZES.map((s) => ({ label: String(s), checked: s === pt, run: () => send("size", s) })))}><Caret /></button>
			<button disabled={noText} onMouseDown={hold} onClick={() => step(1)} title={t("rbGrow")} aria-label={t("rbGrow")}><span className="glyph">가<sup>+</sup></span></button>
			<button disabled={noText} onMouseDown={hold} onClick={() => step(-1)} title={t("rbShrink")} aria-label={t("rbShrink")}><span className="glyph">가<sup>−</sup></span></button>
			<button disabled={noText} aria-pressed={!!info?.bold} onMouseDown={hold} onClick={() => send("toggle", "bold")} title={`${t("rbBold")} (Ctrl+B)`} aria-label={t("rbBold")}><b className="glyph">가</b></button>
			<button disabled={noText} aria-pressed={!!info?.italic} onMouseDown={hold} onClick={() => send("toggle", "italic")} title={`${t("rbItalic")} (Ctrl+I)`} aria-label={t("rbItalic")}><i className="glyph">가</i></button>
			<button disabled={noText} aria-pressed={!!info?.underline} onMouseDown={hold} onClick={() => send("toggle", "underline")} title={`${t("rbUnderline")} (Ctrl+U)`} aria-label={t("rbUnderline")}><u className="glyph">가</u></button>
			<ColorPop label={t("rbFontColor")} current={info?.color} disabled={noText} vars={vars} onPick={(c) => send("color", c)}>
				<span className="glyph">가</span>
			</ColorPop>
			<i className="sep" />

			{/* 단락 */}
			{([["left", "rbLeft", "M2.5 4h11M2.5 7h7M2.5 10h11M2.5 13h7"], ["center", "rbCenter", "M2.5 4h11M4.5 7h7M2.5 10h11M4.5 13h7"], ["right", "rbRight", "M2.5 4h11M6.5 7h7M2.5 10h11M6.5 13h7"]] as const).map(([v, k, d]) => (
				<button key={v} disabled={noText} aria-pressed={align === v} onMouseDown={hold} onClick={() => send("align", v)} title={t(k)} aria-label={t(k)}><Icon d={d} /></button>
			))}
			<button disabled={noText} title={t("rbLineHeight")} aria-label={t("rbLineHeight")}
				onClick={(e) => openMenu(e, LINE_HEIGHTS.map((v) => ({ label: Number.isInteger(v) ? v.toFixed(1) : String(v), checked: info?.lh != null && Math.abs(info.lh - v) < 0.03, run: () => send("lineHeight", v) })))}>
				<Icon d="M7 4h7M7 8h7M7 12h7M3.5 3v10M2 4.5L3.5 3 5 4.5M2 11.5L3.5 13 5 11.5" /><Caret />
			</button>
			{([["flex-start", "rbTop", "M2.5 2.5h11M6 5h4v5H6z"], ["center", "rbMiddle", "M2.5 8h11M6 5h4v6H6z"], ["flex-end", "rbBottom", "M2.5 13.5h11M6 6h4v5H6z"]] as const).map(([v, k, d]) => (
				<button key={v} disabled={noText || !info?.flex} aria-pressed={info?.flex && info.valign === v} onMouseDown={hold} onClick={() => send("valign", v)} title={t(k)} aria-label={t(k)}><Icon d={d} /></button>
			))}
			<i className="sep" />

			{/* 도형 */}
			<ColorPop label={t("rbFill")} current={info?.fill} disabled={none} vars={vars} onPick={(c) => send("fill", c)} onNone={() => send("fill", "transparent")}>
				<Icon d="M3 9l5-5 5 5-5 5zM12.5 11.5c0 1 .7 1.5 1 1.5" />
			</ColorPop>
			<ColorPop label={t("rbOutline")} current={info?.line?.hex} disabled={none} vars={vars} onPick={(c) => send("line", { color: c })} onNone={() => send("line", { none: true })}
				extra={
					<>
						<h4>{t("rbWeight")}</h4>
						<div className="rb-row">
							{WEIGHTS.map((w) => (
								<button key={w} className="rb-w" aria-pressed={info?.line?.w === w} onMouseDown={hold} onClick={() => send("line", { width: w })} title={`${w}px`}>
									<span style={{ height: w }} />
								</button>
							))}
						</div>
					</>
				}>
				<Icon><rect x="3" y="3" width="10" height="10" rx="1" strokeDasharray="2 1.6" /></Icon>
			</ColorPop>
			<i className="sep" />

			{/* 정렬 */}
			<button disabled={none || !info?.abs} title={t("rbArrange")} aria-label={t("rbArrange")}
				onClick={(e) => openMenu(e, [
					{ label: t("rbFront"), run: () => send("arrange", "front") },
					{ label: t("rbForward"), run: () => send("arrange", "forward") },
					{ label: t("rbBackward"), run: () => send("arrange", "backward") },
					{ label: t("rbBack"), run: () => send("arrange", "back") },
				])}>
				<Icon><rect x="2" y="2" width="8" height="8" rx="1" /><path d="M12 6h2v8H6v-2" /></Icon><Caret />
			</button>
			<button disabled={none || !info?.box} title={t("rbAlign")} aria-label={t("rbAlign")}
				onClick={(e) => openMenu(e, [
					{ label: t("rbToLeft"), run: () => send("alignTo", "left") },
					{ label: t("rbToCenter"), run: () => send("alignTo", "center") },
					{ label: t("rbToRight"), run: () => send("alignTo", "right") },
					"-",
					{ label: t("rbToTop"), run: () => send("alignTo", "top") },
					{ label: t("rbToMiddle"), run: () => send("alignTo", "middle") },
					{ label: t("rbToBottom"), run: () => send("alignTo", "bottom") },
				])}>
				<Icon d="M2.5 2v12M5 4.5h8v3H5zM5 9.5h5v3H5z" /><Caret />
			</button>
			<button disabled={none} onClick={() => send("dup")} title={`${t("rbDup")} (Ctrl+D)`} aria-label={t("rbDup")}>
				<Icon><rect x="5" y="5" width="8.5" height="8.5" rx="1" /><path d="M11 3V2.5H2.5V11H3" /></Icon>
			</button>
			<button disabled={none} onClick={() => send("remove")} title={`${t("rbDelete")} (Delete)`} aria-label={t("rbDelete")}>
				<Icon d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9" />
			</button>
			{/* 고른 요소를 요청에 넣기 — 그 요소를 가리키는 핀을 꽂고 대화칸으로 (Workspace askAbout) */}
			{onAsk && (
				<button className="rb-ask" disabled={none} onClick={onAsk} title={t("askElHint")} aria-label={t("askEl")}>
					<Icon d="M3 3.5h10v7H7.5L4.5 13v-2.5H3z" />
					<span>{t("askEl")}</span>
				</button>
			)}
			{placing && <span className="rb-hint">{t("rbPlaceHint")}</span>}
			<button className="rb-close" onClick={() => useRibbon.getState().toggle()} title={`${t("rbHide")} (F)`} aria-label={t("rbHide")}>
				<Icon d="M4 10l4-4 4 4" />
			</button>
		</div>
	);
}

const Caret = () => <svg className="caret" width="8" height="8" viewBox="0 0 8 8" aria-hidden><path d="M1.5 3l2.5 2.5L6.5 3" /></svg>;

/** 색 고르기 — 단추 아래 띠가 지금 색이다. 칸을 누르면 바로 입히고 닫는다 */
function ColorPop({ label, current, disabled, vars, onPick, onNone, extra, children }: {
	label: string; current?: string | null; disabled: boolean; vars: Record<string, string>;
	onPick: (c: string) => void; onNone?: () => void; extra?: React.ReactNode; children: React.ReactNode;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const more = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (!open) return;
		const k = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
		const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
		addEventListener("mousedown", k);
		addEventListener("keydown", esc);
		return () => { removeEventListener("mousedown", k); removeEventListener("keydown", esc); };
	}, [open]);
	// 「다른 색」은 고르기 창을 닫을 때(change) 한 번만 입힌다 — input 사건마다 입히면 끄는 동안 수십 판이 쌓인다
	useEffect(() => {
		const el = more.current;
		if (!el) return;
		const k = () => { onPick(el.value); setOpen(false); };
		el.addEventListener("change", k);
		return () => el.removeEventListener("change", k);
	});
	useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
	const pick = (c: string) => { onPick(c); setOpen(false); };
	// 템플릿 보조 색(--c1 …)도 테마 색 끝에 붙인다
	const theme: [string, string][] = [...THEME.filter(([v]) => vars[v]).map(([v, k]): [string, string] => [v, t(k)]),
		...Object.keys(vars).filter((v) => /^--c\d$/.test(v)).sort().map((v): [string, string] => [v, `${t("paletteMore")} ${v.slice(3)}`])];
	return (
		<div className="rb-pop" ref={ref}>
			<button className="rb-chip" disabled={disabled} aria-expanded={open} onMouseDown={hold} onClick={() => setOpen(!open)} title={label} aria-label={label}>
				{children}
				<Caret />
				<span className="rb-bar" style={{ background: current ? "#" + current : "transparent" }} />
			</button>
			{open && (
				<div className="rb-menu" role="dialog" aria-label={label}>
					{theme.length > 0 && (
						<>
							<h4>{t("rbTheme")}</h4>
							{/* 덱의 변수를 이 칸들에만 건다 — 앱 화면도 --accent 같은 이름을 쓴다 */}
							<div className="rb-sw" style={vars as React.CSSProperties}>
								{theme.map(([v, name]) => (
									<button key={v} style={{ background: `var(${v})` }} onMouseDown={hold} onClick={() => pick(`var(${v})`)} title={name} aria-label={name} />
								))}
							</div>
						</>
					)}
					<h4>{t("rbStd")}</h4>
					<div className="rb-sw">
						{STD.map((c) => (
							<button key={c} style={{ background: c }} aria-pressed={current === c.slice(1)} onMouseDown={hold} onClick={() => pick(c)} title={c} aria-label={c} />
						))}
					</div>
					{extra}
					<div className="rb-row rb-foot">
						{onNone && <button onMouseDown={hold} onClick={() => { onNone(); setOpen(false); }}>{t("rbNone")}</button>}
						<label className="rb-more">{t("rbMore")}<input ref={more} type="color" defaultValue={current ? "#" + current : "#000000"} /></label>
					</div>
				</div>
			)}
		</div>
	);
}

/** 그림 넣기 — 고른 파일을 assets/ 에 복사하고 슬라이드 창이 쪽 가운데에 놓는다 */
async function insertImage(win: React.MutableRefObject<Window | null>, title: string, before: () => void) {
	const st = useDeck.getState();
	const picked = await open({ multiple: false, title, filters: [{ name: title, extensions: [...IMAGE_EXT, "svg"] }] });
	if (!picked || Array.isArray(picked)) return;
	const name = (picked.split(/[\\/]/).pop() || "image").replace(/[\\/:*?"<>|#%\s]+/g, "_");
	const rel = `assets/${Date.now().toString(36)}-${name}`;
	try {
		await api.absCopyIn(picked, st.dir, rel);
	} catch (e) {
		return st.notify(String(e), "err");
	}
	before();
	tell(win.current, { t: "cmd", cmd: "image", v: "../" + rel.split("/").map(encodeURIComponent).join("/") });
}
