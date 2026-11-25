// 대화 — 턴마다 요청 · 답 · 끝줄(그 턴이 남긴 판 v<n> · 고친 쪽)을 쌓는다. 판 번호를 누르면 그 판을 본다.
// 아래 요청칸 위에 아직 보내지 않은 핀이 쌓이고, 보내기 한 번에 글과 핀이 함께 간다.
// 요청칸에서 @ 를 치면 쪽 고르기 창이 뜬다 — 「@3」 · 「@3-5」 로 고칠 쪽을 가리킨다 (mention.ts).
// 「@v」 를 치면 판 고르기 창 — 「@v12」 로 지난 판을 참고하게 한다 (보낼 때 그 판 파일을 펼쳐 넘긴다 · versions.ts).
// 2026.11.24 : 요청칸 접기를 걷고 사이드바 전체를 접는다(Ctrl+B). 접히면 44px 등뼈 — 판 마디 · 도는 중 · 새 답 · 핀 수만 남아
//              무대를 넓게 쓰면서도 Claude 가 일하는 중인지, 보낼 것이 쌓였는지는 잃지 않는다. 접어도 쓰던 글은 그대로다(숨길 뿐 내리지 않는다).
// 2026.11.25 : 왼쪽 56px 실 여백 열과 요청칸 앞 다음 판(점선 v<n+1>)을 걷었다. 그 열 하나 때문에 머리 · 대화 · 요청칸이 모두 왼쪽이 비어
//              좁은 사이드바 폭을 깎았다. 판 번호는 턴 끝줄의 알약으로 옮겼다.
// 2026.11.25 : 요청칸 아랫줄을 「범위 줄」(ScopeLine)로 바꿨다. 보내기 바로 옆에 이 요청이 닿는 곳(덱 전체 · @쪽 · @판)을 보인다.
//              전에는 범위가 어디에도 안 보였고, @쪽을 쓰면 아랫줄에 같은 칩이 한 번 더 나올 뿐이었다. 「@ 로 쪽 지정」은 안내 글에만 있어
//              글을 쓰기 시작하면 사라졌다. 빈 대화의 큰 제목 · 단추 셋도 걷고 범위 줄이 하지 않는 일 둘만 요청칸 바로 위에 남겼다.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { open as pickFiles } from "@tauri-apps/plugin-dialog";
import { api, deckUrl, join } from "../lib/api";
import { ATTACH_EXT, attachName, isImage, useAttach } from "../lib/attach";
import { useT } from "../lib/i18n";
import { isVersionQuery, mentionCandidates, mentionTokens, typingMention, versionCandidates, versionTokens } from "../lib/mention";
import { copyText, openMenu } from "./ContextMenu";
import { SLIDE_MIME, SlideFrame } from "./Workspace";
import { useSettings } from "../lib/settings";
import { routeOf, type Turn, useDeck } from "../lib/store";
import { noteDraft } from "../lib/updater";
import { remote } from "../lib/transport";

/** 사이드바 접힘 — 보는 사람의 편의라 이 PC 에만 남긴다. seen 은 접을 때 본 마지막 턴(그 뒤 끝난 턴이 「새 답」) */
interface Fold { folded: boolean; seen: string | null; draft: boolean; set: (v: boolean) => void }
const FOLD_KEY = "claudeppt.talk.folded";
export const useTalkFold = create<Fold>()((set) => ({
	folded: (() => { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch { return false; } })(),
	seen: null,
	draft: false,
	set: (v) => {
		// 접는 순간 끝나 있는 마지막 턴을 본 것으로 친다. 도는 중이면 비워 두어 끝나면 「새 답」이 된다
		const last = useDeck.getState().turns.at(-1);
		set({ folded: v, seen: v && last && last.status !== "running" ? last.id : null });
		try { localStorage.setItem(FOLD_KEY, v ? "1" : "0"); } catch {}
	},
}));
/** 펴고 요청칸에 손을 둔다 — 「/」 · 등뼈의 쓰기 단추 · 쪽 언급이 부른다 */
export function openTalk(focus = true) {
	if (useTalkFold.getState().folded) useTalkFold.getState().set(false);
	if (focus) requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus());
}

export default function Talk() {
	const t = useT();
	const all = useDeck((s) => s.turns);
	const sessions = useDeck((s) => s.sessions);
	const talkKey = useDeck((s) => s.talkKey);
	const versions = useDeck((s) => s.versions);
	const setPreview = useDeck((s) => s.setPreview);
	const folded = useTalkFold((s) => s.folded);
	const [list, setList] = useState(false);
	// 대화칸은 한 세션의 대화만 — 「새 대화」면 빈 대화가 열린다. 세션을 고르면 그 세션의 대화
	const turns = useMemo(() => (talkKey ? all.filter((x) => (x.session ?? sessions[0]?.key) === talkKey) : all), [all, sessions, talkKey]);
	const logRef = useRef<HTMLDivElement>(null);
	const stick = useRef(true);
	useEffect(() => {
		const el = logRef.current;
		if (el && stick.current) el.scrollTop = el.scrollHeight;
	}, [turns, folded]);
	// Ctrl+B — 접기 · 펴기. 글 칸 안에서도 받는다(굵게 같은 뜻이 없는 칸들이다)
	useEffect(() => {
		const k = (e: KeyboardEvent) => {
			if (!e.ctrlKey || e.altKey || e.shiftKey || e.key.toLowerCase() !== "b") return;
			e.preventDefault();
			const f = useTalkFold.getState();
			if (f.folded) openTalk(); else f.set(true);
		};
		addEventListener("keydown", k);
		return () => removeEventListener("keydown", k);
	}, []);
	const head = versions[0];
	return (
		<aside className={"talk" + (folded ? " folded" : "")} aria-label={t("talk")}>
			{folded && <Spine />}
			{/* 접혀도 내리지 않는다 — 요청칸의 쓰던 글 · 첨부 · 고르기 상태를 잃지 않게 숨기기만 한다 */}
			<div className="talk-body" hidden={folded}>
				<header className="talk-head">
					<b>{t("talk")}</b>
					{/* 지금 보는 세션 — 누르면 세션 목록 */}
					{talkKey && (
						<button className={"talk-sess" + (list ? " on" : "")} onClick={() => setList(!list)} aria-expanded={list} title={t("sessionList")}>
							{t("sessionN").replace("{n}", talkKey.slice(1))}<span aria-hidden>▾</span>
						</button>
					)}
					{/* 지금 판 번호는 제목 줄에 있다 — 여기서는 이 대화의 턴 수만 */}
					{turns.length > 0 && <span className="mono">{turns.length}{t("talkTurns")}</span>}
					{turns.length > 0 && <button className="talk-new" onClick={() => { setList(false); useDeck.getState().newTalk(); }} title={t("newTalkHint")}>{t("newTalk")}</button>}
					<button className="talk-fold" onClick={() => useTalkFold.getState().set(true)} aria-expanded={true} title={`${t("talkFold")} (Ctrl+B)`} aria-label={t("talkFold")}>
						<PanelIcon open />
					</button>
					{list && <SessionList onClose={() => setList(false)} />}
				</header>
				<div className="log" ref={logRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
					{turns.length === 0 ? (
						<EmptyTalk />
					) : (
						turns.map((x) => <TurnView key={x.id} turn={x} head={!!head && x.version?.hash === head.hash} onVersion={() => { const c = versions.find((v) => v.hash === x.version?.hash); if (c) setPreview(c); }} />)
					)}
				</div>
				<Composer />
			</div>
		</aside>
	);
}

/** 오른쪽 판 아이콘 — 열림이면 판을 밀어 닫는 쪽(»), 닫힘이면 꺼내는 쪽(«) */
function PanelIcon({ open }: { open?: boolean }) {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
			<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
			<path d="M10 3v10" stroke="currentColor" strokeWidth="1.3" />
			<path d={open ? "M5 6.2 6.8 8 5 9.8" : "M6.8 6.2 5 8l1.8 1.8"} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

/** 접힌 대화 — 44px 등뼈. 위에서 아래로: 펴기 · 판 마디(새 판이 아래, 누르면 그 판 보기) · 도는 중/새 답 · 핀 수 · 쓰기.
 *  대화를 펴지 않고도 「지금 Claude 가 일하는가 · 끝났는가 · 보낼 것이 쌓였는가」 셋을 읽는다 */
function Spine() {
	const t = useT();
	const turns = useDeck((s) => s.turns);
	const versions = useDeck((s) => s.versions);
	const preview = useDeck((s) => s.preview);
	const setPreview = useDeck((s) => s.setPreview);
	const pins = useDeck((s) => s.pins.length);
	const seen = useTalkFold((s) => s.seen);
	const draft = useTalkFold((s) => s.draft);
	const last = turns.at(-1);
	const running = last?.status === "running";
	const unseen = !!last && !running && last.id !== seen;
	// 판을 남긴 턴만 마디가 된다 — 새 판이 아래(요청칸 쪽). 넘치면 오래된 위쪽이 가려진다
	const nodes = turns.filter((x) => x.version).slice(-40);
	const head = versions[0];
	return (
		<nav className="spine" aria-label={t("talk")}
			onDragOver={(e) => { if (e.dataTransfer.types.includes(SLIDE_MIME)) openTalk(false); }}>
			<button className="sp-btn" onClick={() => openTalk(false)} aria-expanded={false} title={`${t("talkOpen")} (Ctrl+B)`} aria-label={t("talkOpen")}>
				<PanelIcon />
			</button>
			<ol className="sp-thread">
				{nodes.map((x) => {
					const v = x.version!;
					const c = versions.find((k) => k.hash === v.hash);
					const on = preview ? preview.hash === v.hash : v.hash === head?.hash;
					return (
						<li key={x.id}>
							<button className={"sp-node" + (on ? " on" : "")} onClick={() => { if (c) setPreview(c === head ? null : c); }}
								title={`v${v.n} · ${x.request.split("\n")[0].slice(0, 60)}`}>v{v.n}</button>
						</li>
					);
				})}
				{running && <li><span className="sp-run" role="status" aria-label={t("working")} /></li>}
				{unseen && <li><button className="sp-new" onClick={() => openTalk(false)} title={t("talkUnseen")} aria-label={t("talkUnseen")} /></li>}
			</ol>
			<div className="sp-foot">
				{pins > 0 && <button className="sp-pins" onClick={() => openTalk()} title={`${t("pins")} ${pins}`} aria-label={`${t("pins")} ${pins}`}>{pins}</button>}
				<button className={"sp-btn" + (draft ? " draft" : "")} onClick={() => openTalk()} title={`${t("talkWrite")} (/)`} aria-label={t("talkWrite")}>
					<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M3 13l.6-2.6L10.8 3.2a1.4 1.4 0 0 1 2 2L5.6 12.4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
				</button>
			</div>
		</nav>
	);
}

/** 대화가 없을 때 — 빈 자리에 「대화」 글자만 두지 않고, 여기서 바로 시작할 길 셋을 둔다 */
/** 빈 대화. 요청칸 바로 위에 범위 줄이 하지 않는 시작 길 둘과 끌어 놓기 안내. 「이 쪽에 쓰기」는 범위 줄의 「n쪽만」이 한다 */
function EmptyTalk() {
	const t = useT();
	const refill = useDeck((s) => s.refill);
	const setTool = useDeck((s) => s.setTool);
	return (
		<div className="log-empty">
			<button onClick={() => setTool("pen")}><span>{t("startMark")}</span><kbd>1</kbd></button>
			<button onClick={() => refill(t("startPolishText"))}><span>{t("startPolish")}</span></button>
			<p>{t("startDrop")}</p>
		</div>
	);
}

/** 세션 목록 — 새 세션이 위. 세션마다 처음 고친 쪽(그 쪽은 그 뒤에도 이 세션이 이어 고친다) · 마지막 요청자 · 때 · 턴 수.
 *  누르면 그 세션의 대화를 보고, 처음 고치는 쪽은 그 세션으로 간다 */
function SessionList({ onClose }: { onClose: () => void }) {
	const t = useT();
	const sessions = useDeck((s) => s.sessions);
	const turns = useDeck((s) => s.turns);
	const bind = useDeck((s) => s.bind);
	const talkKey = useDeck((s) => s.talkKey);
	const deck = useDeck((s) => s.deck)!;
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const k = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".talk-sess")) onClose(); };
		const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
		addEventListener("mousedown", k);
		addEventListener("keydown", esc);
		return () => { removeEventListener("mousedown", k); removeEventListener("keydown", esc); };
	}, [onClose]);
	const pad = (n: number) => String(n).padStart(2, "0");
	const when = (at: number) => { const d = new Date(at); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
	return (
		<div className="pop sessions" ref={ref} role="listbox" aria-label={t("sessionList")}>
			{[...sessions].reverse().map((s) => {
				const mine = turns.filter((x) => (x.session ?? sessions[0]?.key) === s.key);
				const last = mine.at(-1);
				const nos = deck.slides.map((x, i) => (bind[x.id] === s.key ? i + 1 : 0)).filter((n) => n > 0);
				const on = s.key === talkKey;
				return (
					<button key={s.key} role="option" aria-selected={on} className={on ? "on" : ""} onClick={() => { useDeck.getState().viewSession(s.key); onClose(); }}>
						<span className="s">
							<b>{t("sessionN").replace("{n}", s.key.slice(1))}</b>
							<span>{nos.length ? `${nos.join(" · ")}${t("slideN") === "쪽" ? "쪽" : ""}` : t("sessionNoSlides")}</span>
						</span>
						<span className="d">{last ? `${last.by ? last.by + " · " : ""}${when(last.at)} · ${mine.length}${t("talkTurns")}` : t("sessionEmpty")}</span>
					</button>
				);
			})}
		</div>
	);
}

function TurnView({ turn, head: isHead, onVersion }: { turn: Turn; head: boolean; onVersion: () => void }) {
	const t = useT();
	const deck = useDeck((s) => s.deck)!;
	const setCurrent = useDeck((s) => s.setCurrent);
	const refill = useDeck((s) => s.refill);
	const restore = useDeck((s) => s.restore);
	const running = useDeck((s) => s.running);
	const head = useDeck((s) => s.versions[0]?.hash);
	const commit = useDeck((s) => s.versions.find((v) => v.hash === turn.version?.hash));
	const menu = (e: React.MouseEvent) => openMenu(e, [
		{ label: t("rewrite"), run: () => refill(turn.request), disabled: !turn.request },
		{ label: t("copyReply"), run: () => copyText(turn.reply.trim()), disabled: !turn.reply.trim() },
		"-",
		...(commit ? [
			{ label: `v${commit.n} ${t("viewVersion")}`, run: onVersion },
			{ label: t("compareWith"), run: () => useDeck.getState().startCompare(commit), disabled: commit.hash === head },
			{ label: t("mentionVersion"), kbd: `@v${commit.n}`, run: () => useDeck.getState().mentionVersion(commit.n), disabled: commit.hash === head },
			// 지금 판이면 되돌릴 것이 없다. 턴이 도는 중에 되돌리면 Claude 가 고치던 파일을 덮는다
			{ label: t("restore"), run: () => restore(commit), disabled: commit.hash === head || !!running },
		] : []),
	]);
	const files = useMemo(() => [...new Set(turn.tools.filter((x) => x.name === "Write" || x.name === "Edit" || x.name === "MultiEdit").map((x) => x.file).filter((f): f is string => !!f))], [turn.tools]);
	const reads = turn.tools.filter((x) => x.name === "Read").length;
	// 고친 파일은 쪽 번호로 — slides/sw3xe48.html 같은 내부 이름은 읽을 수 없다. 파일 이름 · 비용은 마우스를 올리면 보인다
	const touched = files.map((f) => deck.slides.findIndex((s) => s.file === f) + 1).filter((n) => n > 0).sort((a, b) => a - b);
	const others = files.filter((f) => f !== "deck.json" && !deck.slides.some((s) => s.file === f));
	const detail = [...files, reads ? `read ×${reads}` : "", turn.cost != null ? `$${turn.cost.toFixed(3)}` : ""].filter(Boolean).join("  ");
	const live = turn.status === "running";
	const changed = touched.length > 0 || others.length > 0;
	return (
		<article className={"turn " + turn.status} onContextMenu={menu}>
			{/* 요청 — 내가 쓴 것은 옅은 칸에 담아 답과 가른다. 핀은 그 칸 안에 */}
			{(turn.request || turn.pins.length > 0 || !!turn.attach?.length) && (
				<div className="req">
					{/* 보낸 팀원 — 같은 세션을 여럿이 이어 쓰므로 요청마다 누가 시켰는지 남긴다 */}
					{turn.by && <div className="req-by">{turn.by}</div>}
					{turn.request && <div className="req-text"><Mentioned text={turn.request} turn={turn} /></div>}
					{!!turn.attach?.length && <div className="attach-row">{turn.attach.map((a) => <AttachTile key={a} rel={a} />)}</div>}
					{turn.pins.length > 0 && (
						<div className="req-pins">
							{turn.pins.map((p) => <div key={p.n}><i>{p.n}</i><span><span style={{ fontSize: 11.5, color: "var(--faint)" }}>{p.slideNo}{t("slideN") === "쪽" ? "쪽" : ""} · </span>{p.text}</span></div>)}
						</div>
					)}
				</div>
			)}
			{(turn.reply || live) && <div className="reply">{turn.reply}</div>}
			{turn.error && <div className="err">{turn.error}</div>}
			{/* 끝줄 — 이 턴이 남긴 판(지금 판은 채움) · 고친 쪽. 도는 중이면 뛰는 점과 지금 하는 일 */}
			{(live || turn.version || changed || turn.status === "stopped" || turn.status === "queued" || turn.phase) && (
				<div className="foot" title={detail}>
					{/* 기다리는 턴 — 같은 세션의 앞 턴이 끝나면(또는 동시에 도는 수에 자리가 나면) 돈다. 멈춤으로 줄에서 뺄 수 있다 */}
					{turn.status === "queued" && <><span className="phase">{t("queued")}</span><button className="more" onClick={() => useDeck.getState().stop(turn.id)}>{t("cancel")}</button></>}
					{live && <span className="run" aria-label={t("working")} />}
					{turn.version && <button className={"node" + (isHead ? " head" : "")} onClick={onVersion} title={`${turn.version.short}${turn.cost != null ? ` · $${turn.cost.toFixed(3)}` : ""}`}>v{turn.version.n}</button>}
					{turn.phase && <span className="phase">{turn.phase}</span>}
					{changed && <span className="lbl">{t("changedSlides")}</span>}
					{touched.map((no) => <button key={no} className="mention" onClick={() => setCurrent(no - 1)}>{no}{t("slideN") === "쪽" ? "쪽" : ""}</button>)}
					{others.length > 0 && <span className="more">{others.some((f) => f.endsWith(".css")) ? t("styleFile") : `+${others.length}`}</span>}
					{turn.status === "stopped" && <span className="more">{t("stopped")}</span>}
				</div>
			)}
		</article>
	);
}

/** 요청 글의 @쪽 을 눌러 그 쪽으로 가는 칩으로 그린다. 지난 턴은 보낼 때 푼 쪽(id)을 따른다 — 그 뒤 순서가 바뀌어도 같은 쪽으로 간다.
 *  @v<n> 은 누르면 그 판을 무대에서 본다 */
function Mentioned({ text, turn }: { text: string; turn?: Turn }) {
	const deck = useDeck((s) => s.deck)!;
	const versions = useDeck((s) => s.versions);
	const setCurrent = useDeck((s) => s.setCurrent);
	const setPreview = useDeck((s) => s.setPreview);
	const toks = [...mentionTokens(text).map((x) => ({ ...x, v: 0 })), ...versionTokens(text).map((x) => ({ start: x.start, end: x.end, from: 0, to: 0, v: x.n }))].sort((a, b) => a.start - b.start);
	if (!toks.length) return <>{text}</>;
	const go = (no: number) => {
		const id = turn?.mentions?.find((m) => m.no === no)?.id;
		const i = id ? deck.slides.findIndex((s) => s.id === id) : no - 1;
		if (i >= 0 && i < deck.slides.length) setCurrent(i);
	};
	const goV = (n: number) => {
		const hash = turn?.versionMentions?.find((m) => m.n === n)?.hash;
		const c = versions.find((x) => (hash ? x.hash === hash : x.n === n));
		if (c) setPreview(c);
	};
	const out: React.ReactNode[] = [];
	let at = 0;
	toks.forEach((tk, k) => {
		out.push(<Fragment key={"t" + k}>{text.slice(at, tk.start)}</Fragment>);
		out.push(<button key={"m" + k} className="mention" onClick={() => (tk.v ? goV(tk.v) : go(tk.from))}>{text.slice(tk.start, tk.end).trim()}</button>);
		at = tk.end;
	});
	out.push(<Fragment key="end">{text.slice(at)}</Fragment>);
	return <>{out}</>;
}

/** 요청칸 위 쌓인 표시의 종류 — 글자 한 자로 (핀은 비워 둔다) */
const GLYPH = { pen: "〰", arrow: "→", box: "▭" } as const;

function Composer() {
	const t = useT();
	const pins = useDeck((s) => s.pins);
	const deck = useDeck((s) => s.deck)!;
	// 지금 대화에서 도는 턴 — 멈춤은 이 턴만. 다른 세션이 돌고 있어도 보낼 수 있다(기다리거나 함께 돈다)
	const myRun = useDeck((s) => (s.talkKey ? s.runs[s.talkKey] : undefined));
	const send = useDeck((s) => s.send);
	const stop = useDeck((s) => s.stop);
	const update = useDeck((s) => s.updatePin);
	const remove = useDeck((s) => s.removePin);
	const setCurrent = useDeck((s) => s.setCurrent);
	const current = useDeck((s) => s.current);
	const insertReq = useDeck((s) => s.insertReq);
	const rev = useDeck((s) => s.rev);
	const [text, setText] = useState("");
	// 이 기기를 쓰는 팀원 — 정하기 전에는 요청칸 위에 이름 칸이 뜨고 보내기가 막힌다
	const myName = useSettings((x) => x.s.me).trim();
	const saveName = (v: string) => { if (v.trim()) useSettings.getState().set((x) => ({ ...x, me: v.trim() })); };
	// 보낼 곳 — 보내기와 같은 규칙(routeOf). 보고 있는 대화와 다른 세션으로 가면 그 까닭(그 쪽을 처음 고친 세션)을 보인다
	const bind = useDeck((s) => s.bind);
	const sessions = useDeck((s) => s.sessions);
	const talkKey = useDeck((s) => s.talkKey);
	// 쪽 목록 · 이어 보기에서 쪽을 끌어 요청칸 위에 올린 동안 — 놓으면 @쪽 이 들어간다
	const [dropping, setDropping] = useState(false);
	const mentionSlide = useDeck((s) => s.mentionSlide);
	const attach = useAttach((s) => s.files);
	const ta = useRef<HTMLTextAreaElement>(null);
	// @ 고르기 창 — start 는 @ 자리, sel 은 고른 줄
	const [pick, setPick] = useState<{ start: number; q: string; sel: number } | null>(null);
	const versions = useDeck((s) => s.versions);
	// 「@v…」 를 적는 중이면 판 고르기, 아니면 쪽 고르기
	const vpick = !!pick && isVersionQuery(pick.q);
	const cands = useMemo(() => (pick && !vpick ? mentionCandidates(deck, pick.q, current) : []), [pick, vpick, deck, current]);
	const vcands = useMemo(() => (pick && vpick ? versionCandidates(versions, pick.q) : []), [pick, vpick, versions]);
	const count = vpick ? vcands.length : cands.length;
	const sense = (value: string, caret: number) => {
		const m = typingMention(value, caret);
		setPick(m ? { ...m, sel: 0 } : null);
	};
	/** 글의 [from, to) 를 「@번호 」 · 「@v번호 」로 바꾸고 커서를 그 뒤에 둔다 */
	const put = (from: number, to: number, tag: string) => {
		const ins = `${tag} `;
		const next = text.slice(0, from) + ins + text.slice(to).replace(/^ /, "");
		setText(next);
		setPick(null);
		requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.setSelectionRange(from + ins.length, from + ins.length); } });
	};
	/** 고르기 창의 i 번째 줄을 넣는다 */
	const choose = (i: number, to: number) => put(pick!.start, to, vpick ? `@v${vcands[i].n}` : `@${cands[i].no}`);
	// 방향키로 고른 줄이 고르기 창 밖으로 나가지 않게
	useEffect(() => { document.querySelector(".picker .on")?.scrollIntoView({ block: "nearest" }); }, [pick?.sel]);
	// 「이 쪽 언급」 — 커서 자리에 넣는다. 앞 글자에 붙지 않게 빈칸을 둔다. 「요청 다시 쓰기」 — 칸 전체를 바꾼다
	useEffect(() => {
		if (!insertReq) return;
		openTalk(false);
		const el = ta.current;
		if (insertReq.whole) {
			setText(insertReq.text);
			requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(insertReq.text.length, insertReq.text.length); });
			return;
		}
		const at = el ? el.selectionStart : text.length;
		const pad = at > 0 && !/\s/.test(text[at - 1]) ? " " : "";
		const ins = `${pad}${insertReq.text} `;
		setText(text.slice(0, at) + ins + text.slice(at));
		requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + ins.length, at + ins.length); });
	}, [insertReq]);
	useEffect(() => {
		const el = ta.current!;
		el.style.height = "auto";
		el.style.height = Math.min(220, el.scrollHeight) + "px";
	}, [text]);
	// 접힌 등뼈가 「쓰던 글이 있다」를 보이게 알린다. 쉬는 틈 자동 설치도 미룬다 — 다시 켜면 이 글이 사라진다 (updater.ts)
	const hasDraft = !!text.trim();
	useEffect(() => { useTalkFold.setState({ draft: hasDraft }); noteDraft(hasDraft); }, [hasDraft]);
	useEffect(() => () => noteDraft(false), []);
	// 핀이 새로 꽂히면 대화를 편다 — 접힌 채로 두면 의견을 적을 칸이 보이지 않는다
	const pinCount = useRef(pins.length);
	useEffect(() => { if (pins.length > pinCount.current) openTalk(false); pinCount.current = pins.length; }, [pins.length]);
	// 「/」 — 어디서든 요청칸으로(접혀 있으면 편다). 입력 중인 칸에서는 그냥 글자다
	useEffect(() => {
		const k = (e: KeyboardEvent) => {
			if (e.key !== "/" || e.ctrlKey || e.altKey || e.metaKey) return;
			if ((e.target as Element).closest?.("input, textarea, [contenteditable]")) return;
			e.preventDefault();
			openTalk();
		};
		addEventListener("keydown", k);
		return () => removeEventListener("keydown", k);
	}, []);

	const route = useMemo(() => routeOf({ deck, current, pins, bind, sessions, talkKey }, text), [deck, current, pins, bind, sessions, talkKey, text]);
	const routeText = !route.key ? t("routeNew") : (route.via ? t("routeVia").replace("{no}", String(route.via)) : t("routeTalk")).replace("{n}", route.key.slice(1));
	const can = !!myName && (text.trim() || pins.length || attach.length);
	const go = () => {
		if (!can) return;
		send(text, attach);
		setText("");
		setPick(null);
		useAttach.getState().clear();
	};
	// 붙여 넣은 파일(그림 · PDF · 글)은 .claudeppt/attach 에 두고 경로를 요청에 붙인다 (attach.ts). 글자만 붙이면 그대로 글이다
	const onPaste = (e: React.ClipboardEvent) => {
		const files = [...e.clipboardData.files];
		if (!files.length) return;
		e.preventDefault();
		useAttach.getState().addBlobs(files);
	};
	const slideNo = (id: string) => deck.slides.findIndex((s) => s.id === id) + 1;

	// 지금 대화가 돌고 있고 쓴 것이 없으면 멈춤. 쓰고 있으면 보내기(그 세션 앞 턴이 끝난 뒤 돈다)
	const sendBtn = myRun && !can ? (
		<button className="send stop" onClick={() => stop(myRun)}>{t("stop")}</button>
	) : (
		<button className={"send" + (pins.length ? " pins" : "")} disabled={!can} onClick={go}>
			{pins.length ? `${t("sendPins")} ${pins.length}` : t("send")}<kbd>↵</kbd>
		</button>
	);
	return (
		<div className="composer">
			{!myName && (
				<div className="whoami" title={t("myNameNote")}>
					<span>{t("myName")}</span>
					<input className="field" placeholder={t("myNamePh")} aria-label={t("myName")}
						onBlur={(e) => saveName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveName(e.currentTarget.value); }} />
				</div>
			)}
			{pins.length > 0 && (
				<div className="tray" aria-label={t("pins")}>
					{pins.map((p, i) => (
						<div className="tray-pin" key={p.id}>
							<span className="n">{i + 1}</span>
							<button className="where" onClick={() => setCurrent(slideNo(p.slide) - 1)}>{slideNo(p.slide)}{t("slideN") === "쪽" ? "쪽" : ""}{p.shape ? ` ${GLYPH[p.shape.kind]}` : ""}</button>
							<input defaultValue={p.text} key={p.text} placeholder={p.target?.text || t("pinPlaceholder")} aria-label={`${t("pin")} ${i + 1}`} onBlur={(e) => { if (e.target.value !== p.text) update(p.id, e.target.value); }}
								onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); if (e.ctrlKey) go(); } }} />
							<button className="x" onClick={() => remove(p.id)} aria-label={t("delete")}>×</button>
						</div>
					))}
				</div>
			)}
			<div className={"box" + (dropping ? " dropping" : "")} data-drop={t("dropMention")}
				onDragOver={(e) => { if (!e.dataTransfer.types.includes(SLIDE_MIME)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropping(true); }}
				onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false); }}
				onDrop={(e) => {
					setDropping(false);
					const no = deck.slides.findIndex((s) => s.id === e.dataTransfer.getData(SLIDE_MIME)) + 1;
					if (!no) return;
					e.preventDefault();
					mentionSlide(no);
				}}>
				{/* 첨부는 범위 줄(어디에 닿는가)과 따로, 글 위 한 줄에. 「무엇을 함께 보내는가」 */}
				{attach.length > 0 && <div className="attach-row">{attach.map((a) => <AttachTile key={a} rel={a} onRemove={() => useAttach.getState().remove(a)} />)}</div>}
				{pick && (
					<div className="picker" role="listbox" aria-label={t("slides")}>
						{count === 0 && <div className="none">{vpick ? t("mentionVersionNone") : t("mentionNone")}</div>}
						{vcands.map((c, i) => (
							<button key={c.hash} role="option" aria-selected={i === pick.sel} className={"ver" + (i === pick.sel ? " on" : "")}
								onMouseDown={(e) => { e.preventDefault(); choose(i, ta.current?.selectionStart ?? text.length); }}
								onMouseEnter={() => setPick({ ...pick, sel: i })}>
								<span className="mono">@v{c.n}</span>
								<span className="title">{c.subject}</span>
								<span className="here mono">{c.date.slice(5, 16)}</span>
							</button>
						))}
						{cands.map((m, i) => (
							<button key={m.id} role="option" aria-selected={i === pick.sel} className={i === pick.sel ? "on" : ""}
								onMouseDown={(e) => { e.preventDefault(); choose(i, ta.current?.selectionStart ?? text.length); }}
								onMouseEnter={() => setPick({ ...pick, sel: i })}>
								<span className="mono">@{m.no}</span>
								{/* 작은 미리보기 — 제목이 없는 쪽(가져온 덱에 흔하다)도 모양으로 가려 고르게 */}
								<span className="pthumb" style={{ height: (64 * deck.size.h) / deck.size.w }}><SlideFrame file={m.file} rev={rev[m.id] || 0} w={deck.size.w} h={deck.size.h} width={64} /></span>
								<span className="title">{m.title || t("untitled")}</span>
								{m.no === current + 1 && <span className="here">{t("here")}</span>}
							</button>
						))}
						{/* 판도 멘션할 수 있다는 것을 쪽 고르기 창 끝에서 알린다 — 「@v」 를 모르면 쓸 길이 없다 */}
						{!vpick && versions.length > 1 && <div className="none">{t("mentionVersionHint")}</div>}
					</div>
				)}
				<textarea ref={ta} rows={2} value={text} placeholder={t("composerHint")} onPaste={onPaste}
					onChange={(e) => { setText(e.target.value); sense(e.target.value, e.target.selectionStart); }}
					onClick={(e) => sense(text, e.currentTarget.selectionStart)}
					onBlur={() => setPick(null)}
					onKeyDown={(e) => {
						if (e.nativeEvent.isComposing) return;
						// 고르기 창이 떠 있으면 위아래 · Enter · Tab · Esc 는 창이 쓴다
						if (pick && count) {
							if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setPick({ ...pick, sel: (pick.sel + (e.key === "ArrowDown" ? 1 : count - 1)) % count }); return; }
							if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(pick.sel, e.currentTarget.selectionStart); return; }
						}
						if (pick && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPick(null); return; }
						if (e.key === "Enter" && (e.ctrlKey || !e.shiftKey)) { e.preventDefault(); go(); }
					}}
					onKeyUp={(e) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) sense(text, e.currentTarget.selectionStart); }} />
				<div className="bar">
					<ScopeLine text={text} setText={setText} ta={ta} />
					{/* 보낼 곳(세션). 범위 줄이 「어디에」면 이것은 「어느 세션으로」. 세션이 생긴 뒤부터 보이고, 보고 있는 대화와 다른 세션으로 가면 진하게.
					    줄에는 세션 번호만, 까닭(어느 쪽을 처음 고친 세션인지)은 툴팁에. 까닭까지 적으면 좁은 사이드바에서 범위 줄이 두 줄로 밀린다 */}
					{sessions.length > 0 && (
						<span className={"route" + (route.key && route.key !== talkKey ? " away" : "")} title={`${routeText}\n${t("sessionHint")}`}>
							{route.key ? `→ ${t("sessionN").replace("{n}", route.key.slice(1))}` : t("routeNew")}
						</span>
					)}
					{sendBtn}
				</div>
			</div>
		</div>
	);
}

/**
 * 범위 줄. 이 요청이 닿는 곳을 보내기 바로 옆에 보인다.
 *   @쪽 · @판을 썼으면 그 덩이마다 칩 (누르면 그 쪽 · 판으로, × 는 글에서도 뺀다)
 *   안 썼으면 「덱 전체」와 지금 쪽 하나로 좁히는 「n쪽만」. 그 뒤 「@」는 쪽 고르기 창을 연다
 * 범위를 정하는 것은 글 안의 @ 하나다. 칩은 그 글을 비추고 고칠 뿐, 따로 상태를 쥐지 않는다
 */
function ScopeLine({ text, setText, ta }: { text: string; setText: (v: string) => void; ta: React.RefObject<HTMLTextAreaElement | null> }) {
	const t = useT();
	const deck = useDeck((s) => s.deck)!;
	const current = useDeck((s) => s.current);
	const versions = useDeck((s) => s.versions);
	const setCurrent = useDeck((s) => s.setCurrent);
	const setPreview = useDeck((s) => s.setPreview);
	const mentionSlide = useDeck((s) => s.mentionSlide);
	/** 클립. 파일을 골라 붙인다. 읽을 수 있는 종류만 보이게 거른다 */
	const choose = async () => {
		const p = await pickFiles({ multiple: true, filters: [{ name: t("attachKinds"), extensions: ATTACH_EXT }] });
		const list = Array.isArray(p) ? p : p ? [p] : [];
		if (list.length) await useAttach.getState().addPaths(list);
		ta.current?.focus();
	};
	const toks = useMemo(() => [
		...mentionTokens(text).filter((x) => x.from >= 1 && x.from <= deck.slides.length).map((x) => ({ ...x, v: 0 })),
		...versionTokens(text).filter((x) => versions.some((c) => c.n === x.n)).map((x) => ({ start: x.start, end: x.end, from: 0, to: 0, v: x.n })),
	].sort((a, b) => a.start - b.start), [text, deck, versions]);
	const slideTitle = (no: number) => deck.slides[no - 1]?.title || "";
	/** 칩의 ×. 글에서 그 덩이와 뒤 빈칸 하나를 뺀다 */
	const drop = (start: number, end: number) => {
		setText((text.slice(0, start) + text.slice(end).replace(/^ /, "")).replace(/^ /, ""));
		requestAnimationFrame(() => ta.current?.focus());
	};
	/** 「@」. 커서 자리에 @ 를 넣고 고르기 창을 연다 (요청칸의 onChange 가 창을 띄운다) */
	const pickSlide = () => {
		const el = ta.current;
		if (!el) return;
		el.focus();
		const at = el.selectionStart ?? text.length;
		const pad = at > 0 && !/\s/.test(text[at - 1]) ? " " : "";
		// 리액트가 쥔 값을 바꾸고 input 사건을 일으켜 고르기 창 감지(sense)가 돌게 한다
		const next = text.slice(0, at) + pad + "@" + text.slice(at);
		const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
		set.call(el, next);
		el.setSelectionRange(at + pad.length + 1, at + pad.length + 1);
		el.dispatchEvent(new Event("input", { bubbles: true }));
	};
	return (
		<div className="scope" aria-label={t("scope")}>
			{toks.length === 0 ? (
				<>
					<span className="scope-all">{t("scopeAll")}</span>
					<button className="scope-btn" onClick={() => mentionSlide(current + 1)} title={slideTitle(current + 1)}>{t("scopeOnly").replace("{n}", String(current + 1))}</button>
				</>
			) : (
				toks.map((x) => {
					const label = x.v ? `@v${x.v}` : x.from === x.to ? `@${x.from}` : `@${x.from}-${x.to}`;
					const tip = x.v ? versions.find((c) => c.n === x.v)?.subject : x.from === x.to ? slideTitle(x.from) : "";
					return (
						<span className="scope-chip" key={x.start}>
							<button onClick={() => { if (x.v) { const c = versions.find((k) => k.n === x.v); if (c) setPreview(c); } else setCurrent(x.from - 1); }} title={tip || undefined}>{label}</button>
							<button className="x" onClick={() => drop(x.start, x.end)} aria-label={`${label} ${t("delete")}`}>×</button>
						</span>
					);
				})
			)}
			<button className="scope-btn at" onClick={pickSlide} title={t("scopePick")} aria-label={t("scopePick")}>@</button>
			{!remote && <button className="scope-btn clip" onClick={choose} title={t("attachAdd")} aria-label={t("attachAdd")}>
				<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M10.5 4.5 5.4 9.6a1.6 1.6 0 0 0 2.3 2.3l5.4-5.4a3 3 0 0 0-4.3-4.3L3.3 7.7a4.4 4.4 0 0 0 6.2 6.2l4-4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
			</button>}
		</div>
	);
}

/** 첨부 하나. 그림은 알아볼 크기의 미리보기, 그 밖은 이름과 확장자. 누르면 탐색기에서 그 파일을 보인다. onRemove 가 있으면 모서리 × */
function AttachTile({ rel, onRemove }: { rel: string; onRemove?: () => void }) {
	const t = useT();
	const id = useDeck((s) => s.id);
	const dir = useDeck((s) => s.dir);
	const name = attachName(rel);
	const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || "").toUpperCase();
	const stem = name.replace(/\.[a-z0-9]+$/i, "");
	return (
		<span className={"att" + (isImage(rel) ? " img" : "")}>
			<button onClick={() => api.reveal(join(dir, rel))} title={name} aria-label={name}>
				{isImage(rel) ? <img src={deckUrl(id, rel)} alt="" /> : <><span className="nm">{stem}</span><span className="ext">{ext}</span></>}
			</button>
			{onRemove && <button className="x" onClick={onRemove} aria-label={`${name} ${t("delete")}`}>×</button>}
		</span>
	);
}
