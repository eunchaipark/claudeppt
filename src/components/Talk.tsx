// 대화 — 턴마다 요청 · 답 · 끝줄(그 턴이 남긴 판 v<n> · 고친 쪽)을 쌓는다. 판 번호를 누르면 그 판을 본다.
// 아래 요청칸 위에 아직 보내지 않은 핀이 쌓이고, 보내기 한 번에 글과 핀이 함께 간다.
// 요청칸에서 @ 를 치면 쪽 고르기 창이 뜬다 — 「@3」 · 「@3-5」 로 고칠 쪽을 가리킨다 (mention.ts).
// 「@v」 를 치면 판 고르기 창 — 「@v12」 로 지난 판을 참고하게 한다 (보낼 때 그 판 파일을 펼쳐 넘긴다 · versions.ts).
// 2026.11.24 : 요청칸 접기를 걷고 사이드바 전체를 접는다(Ctrl+B). 접히면 44px 등뼈 — 판 마디 · 도는 중 · 새 답 · 핀 수만 남아
//              무대를 넓게 쓰면서도 Claude 가 일하는 중인지, 보낼 것이 쌓였는지는 잃지 않는다. 접어도 쓰던 글은 그대로다(숨길 뿐 내리지 않는다).
// 2026.11.25 : 왼쪽 56px 실 여백 열과 요청칸 앞 다음 판(점선 v<n+1>)을 걷었다. 그 열 하나 때문에 머리 · 대화 · 요청칸이 모두 왼쪽이 비어
//              좁은 사이드바 폭을 깎았다. 판 번호는 턴 끝줄의 알약으로 옮겼다.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { api, b64FromBytes } from "../lib/api";
import { useT } from "../lib/i18n";
import { isVersionQuery, mentionCandidates, mentionTokens, mentionsIn, typingMention, versionCandidates, versionMentionsIn, versionTokens } from "../lib/mention";
import { copyText, openMenu } from "./ContextMenu";
import { SLIDE_MIME, SlideFrame } from "./Workspace";
import { useSettings } from "../lib/settings";
import { type Turn, useDeck } from "../lib/store";

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
	const turns = useDeck((s) => s.turns);
	const versions = useDeck((s) => s.versions);
	const setPreview = useDeck((s) => s.setPreview);
	const folded = useTalkFold((s) => s.folded);
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
					{/* 지금 판 번호는 제목 줄에 있다 — 여기서는 턴 수만 */}
					{turns.length > 0 && <span className="mono">{turns.length}{t("talkTurns")}</span>}
					{turns.length > 0 && <button className="talk-new" onClick={() => useDeck.getState().newTalk()} title={t("newTalkHint")}>{t("newTalk")}</button>}
					<button className="talk-fold" onClick={() => useTalkFold.getState().set(true)} aria-expanded={true} title={`${t("talkFold")} (Ctrl+B)`} aria-label={t("talkFold")}>
						<PanelIcon open />
					</button>
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
function EmptyTalk() {
	const t = useT();
	const current = useDeck((s) => s.current);
	const mentionSlide = useDeck((s) => s.mentionSlide);
	const refill = useDeck((s) => s.refill);
	const setTool = useDeck((s) => s.setTool);
	return (
		<div className="log-empty">
			<b>{t("emptyTalk")}</b>
			<button onClick={() => mentionSlide(current + 1)}><span>{t("startThis")}</span><kbd>@{current + 1}</kbd></button>
			<button onClick={() => setTool("pen")}><span>{t("startMark")}</span><kbd>1</kbd></button>
			<button onClick={() => refill(t("startPolishText"))}><span>{t("startPolish")}</span><kbd>↵</kbd></button>
			<p>{t("startDrop")}</p>
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
			{(turn.request || turn.pins.length > 0) && (
				<div className="req">
					{/* 보낸 팀원 — 같은 세션을 여럿이 이어 쓰므로 요청마다 누가 시켰는지 남긴다 */}
					{turn.by && <div className="req-by">{turn.by}</div>}
					{turn.request && <div className="req-text"><Mentioned text={turn.request} turn={turn} /></div>}
					{turn.pins.length > 0 && (
						<div className="req-pins">
							{turn.pins.map((p) => <div key={p.n}><i>{p.n}</i><span><span style={{ fontSize: 11.5, color: "var(--faint)" }}>{p.slideNo}{t("slideN") === "쪽" ? "쪽" : ""} · </span>{p.text || "—"}</span></div>)}
						</div>
					)}
				</div>
			)}
			{(turn.reply || live) && <div className="reply">{turn.reply}</div>}
			{turn.error && <div className="err">{turn.error}</div>}
			{/* 끝줄 — 이 턴이 남긴 판(지금 판은 채움) · 고친 쪽. 도는 중이면 뛰는 점과 지금 하는 일 */}
			{(live || turn.version || changed || turn.status === "stopped" || turn.phase || turn.session) && (
				<div className="foot" title={detail}>
					{live && <span className="run" aria-label={t("working")} />}
					{turn.version && <button className={"node" + (isHead ? " head" : "")} onClick={onVersion} title={`${turn.version.short}${turn.cost != null ? ` · $${turn.cost.toFixed(3)}` : ""}`}>v{turn.version.n}</button>}
					{turn.session && <span className="more" title={t("sessionHint")}>{t("sessionN").replace("{n}", turn.session.slice(1))}</span>}
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
	const running = useDeck((s) => s.running);
	const send = useDeck((s) => s.send);
	const stop = useDeck((s) => s.stop);
	const update = useDeck((s) => s.updatePin);
	const remove = useDeck((s) => s.removePin);
	const setCurrent = useDeck((s) => s.setCurrent);
	const dir = useDeck((s) => s.dir);
	const current = useDeck((s) => s.current);
	const insertReq = useDeck((s) => s.insertReq);
	const rev = useDeck((s) => s.rev);
	const [text, setText] = useState("");
	// 이 기기를 쓰는 팀원 — 정하기 전에는 요청칸 위에 이름 칸이 뜨고 보내기가 막힌다
	const myName = useSettings((x) => x.s.me).trim();
	const saveName = (v: string) => { if (v.trim()) useSettings.getState().set((x) => ({ ...x, me: v.trim() })); };
	// 쪽 목록 · 이어 보기에서 쪽을 끌어 요청칸 위에 올린 동안 — 놓으면 @쪽 이 들어간다
	const [dropping, setDropping] = useState(false);
	const mentionSlide = useDeck((s) => s.mentionSlide);
	const [attach, setAttach] = useState<string[]>([]);
	const ta = useRef<HTMLTextAreaElement>(null);
	// @ 고르기 창 — start 는 @ 자리, sel 은 고른 줄
	const [pick, setPick] = useState<{ start: number; q: string; sel: number } | null>(null);
	const versions = useDeck((s) => s.versions);
	const setPreview = useDeck((s) => s.setPreview);
	// 「@v…」 를 적는 중이면 판 고르기, 아니면 쪽 고르기
	const vpick = !!pick && isVersionQuery(pick.q);
	const cands = useMemo(() => (pick && !vpick ? mentionCandidates(deck, pick.q, current) : []), [pick, vpick, deck, current]);
	const vcands = useMemo(() => (pick && vpick ? versionCandidates(versions, pick.q) : []), [pick, vpick, versions]);
	const count = vpick ? vcands.length : cands.length;
	const mentioned = useMemo(() => mentionsIn(text, deck), [text, deck]);
	const vmentioned = useMemo(() => versionMentionsIn(text, versions), [text, versions]);
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
	// 접힌 등뼈가 「쓰던 글이 있다」를 보이게 알린다
	const hasDraft = !!text.trim();
	useEffect(() => { useTalkFold.setState({ draft: hasDraft }); }, [hasDraft]);
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

	const can = !running && !!myName && (text.trim() || pins.length);
	const go = () => {
		if (!can) return;
		send(text, attach);
		setText("");
		setPick(null);
		setAttach([]);
	};
	// 붙여 넣은 그림은 .claudeppt/attach 에 두고 경로를 요청에 붙인다 (Claude 의 Read 가 그림을 본다)
	const onPaste = async (e: React.ClipboardEvent) => {
		const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
		if (!files.length) return;
		e.preventDefault();
		for (const f of files) {
			const rel = `.claudeppt/attach/${Date.now().toString(36)}.${f.type.split("/")[1] || "png"}`;
			await api.writeB64(dir, rel, b64FromBytes(new Uint8Array(await f.arrayBuffer())));
			setAttach((a) => [...a, rel]);
		}
	};
	const slideNo = (id: string) => deck.slides.findIndex((s) => s.id === id) + 1;

	const sendBtn = running ? (
		<button className="send stop" onClick={stop}>{t("stop")}</button>
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
					<div className="attach">
						{mentioned.map((m) => <button key={m.id} className="mention" onClick={() => setCurrent(m.no - 1)} title={m.title || ""}>@{m.no}{m.title ? ` ${m.title}` : ""}</button>)}
						{vmentioned.map((m) => <button key={m.hash} className="mention" onClick={() => { const c = versions.find((x) => x.hash === m.hash); if (c) setPreview(c); }} title={`${m.date} · ${m.subject}`}>@v{m.n} {m.subject.slice(0, 24)}</button>)}
						{attach.map((a) => <span key={a}>{a.split("/").pop()}<button onClick={() => setAttach(attach.filter((x) => x !== a))}>×</button></span>)}
					</div>
					{sendBtn}
				</div>
			</div>
		</div>
	);
}
