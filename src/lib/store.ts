// 열린 프로젝트 하나의 상태 — 덱 · 쪽마다 다시 그릴 표식 · 핀 · 대화 · 판.
//
// 목차
//   열기 · 닫기          openProject · closeProject (폴더 감시와 deck:// 등록은 Rust)
//   핫 리로드            onFs — deck.json 이면 목차를, 쪽 HTML 이면 그 쪽만, CSS 면 CSS 만 다시 읽힌다
//   핀                   addPin · updatePin · removePin → .claudeppt/pins.json
//   무대 보기            setFlow — 한 쪽 보기 ↔ 이어 보기(모든 쪽을 세로로 스크롤)
//   요청칸 채우기        mentionSlide — 요청칸에 @쪽 넣기 · refill — 지난 요청을 다시 쓰기 (우클릭 메뉴 · 쪽 목록에서)
//   쪽 손보기            addSlide · duplicateSlide · moveSlide · removeSlide — 쪽 목록 · 우클릭 메뉴가 같이 쓴다
//   대화                 send → claude 한 턴 → 그림 채우기 → 한 판으로 남김 → .claudeppt/talk.json
//   바깥 작업            outside · OUTSIDE_MS — 앱 밖 Claude Code 가 방금 다룬 덱이면 send 가 보내기 전에 한 번 묻는다 (remote.ts touch)
//   직접 편집            applyDirect → 원본 HTML 에 되쓰고 잠시 뒤 한 판으로 남김
//   판 · 릴리즈          refreshVersions · preview · restore · release (릴리즈 본체는 파일 끝 makeRelease — 바깥 CLI 도 쓴다)
//   판 비교              startCompare · closeCompare · restoreSlide — 고른 판과 지금을 쪽마다 견주고 한 쪽만 되돌린다 (versions.ts)
//   판 멘션              mentionVersion · send 의 @v<n> — 그 판 파일을 펼쳐 Claude 가 참고로 읽는다 (versions.ts versionContext)
//   내보낸 PPTX 확인     verifyPptx — 내보내기 · 릴리즈 뒤 PowerPoint 가 그린 모양을 웹과 견주어 다를 때만 알린다 (check.ts) · fixDiff
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { api, type Commit } from "./api";
import { type Deck, newId, readDeck, slideHtml, writeDeck } from "./deck";
import { applyOp, type Op } from "./edits";
import { type Built, buildPptx } from "./exportPptx";
import { type Report, SAME, needsFix, runCheck } from "./check";
import { tell } from "./frames";
import { tNow } from "./i18n";
import { askClaude, linkFonts } from "./fonts";
import { fillGenerated } from "./imagegen";
import { markedPictures, type Shape, type Tool } from "./markup";
import { type Mention, type VersionMention, mentionsIn, versionMentionsIn } from "./mention";
import { type PinNote, systemPrompt, turnPrompt } from "./prompt";
import { useSettings } from "./settings";
import { type VersionDiff, diffVersion, restoreSlide as restoreSlideFile, versionContext } from "./versions";

/** 핀 하나 — shape 가 있으면 그어 놓은 표시(펜 · 화살표 · 상자)이고 x, y 는 그 번호 표식 자리다 (markup.ts) */
export interface Pin { id: string; slide: string; x: number; y: number; text: string; target?: PinNote["target"]; shape?: Shape; at: number }
export interface ToolUse { name: string; file?: string }
export interface Turn {
	id: string;
	at: number;
	request: string;
	pins: PinNote[];
	/** 요청 글의 @쪽 멘션을 보낼 때 푼 것 — 쪽 순서가 나중에 바뀌어도 같은 쪽을 가리킨다 */
	mentions?: Mention[];
	/** 요청 글의 @v<n> 판 멘션 — 지난 대화에서 그 판을 열 수 있게 커밋을 남긴다 */
	versionMentions?: VersionMention[];
	/** 사용자가 붙인 첨부 (.claudeppt/attach/…). 지난 요청에 무엇을 붙였는지 보인다. 표시 그림(marks-*)은 앱이 만든 것이라 넣지 않는다 */
	attach?: string[];
	reply: string;
	tools: ToolUse[];
	status: "running" | "done" | "failed" | "stopped";
	cost?: number;
	version?: { n: number; short: string; hash: string };
	error?: string;
	phase?: string;
}
/** 화면 뒤에서 도는 긴 일(PPTX 가져오기) 하나. n 이 0 이면 아직 전체 양을 모른다 */
export interface Job { id: string; label: string; i: number; n: number; note?: string }
export interface Release { name: string; tag: string; n: number; hash: string; file: string; notes: string; at: string }
export type Mode = "view" | "pin" | "edit";

interface S {
	dir: string;
	id: string;
	deck: Deck | null;
	rev: Record<string, number>;
	current: number;
	mode: Mode;
	/** 이어 보기 — 무대에 모든 쪽을 세로로 늘어놓고 스크롤로 넘긴다. 보기 모드에서만 쓴다 */
	flow: boolean;
	/** 무대 도구 — 고르기(보면서 바로 고치기) · 펜 · 화살표 · 상자. mode 는 이것에서 나온다(고르기 → edit, 나머지 → pin).
	 *  2026.11.18 : 보기 · 표시 · 편집 세 모드를 도구 하나로 합쳤다 — 보다가 고치려면 매번 모드를 바꿔야 했다 */
	tool: Tool | "select" | "sketch";
	/** 요청칸에 넣어 달라는 글 — 커서 자리에 끼우거나(whole 아님) 칸 전체를 바꾼다. k 는 같은 글을 거듭 보내도 다시 넣게 하는 표식 */
	insertReq: { text: string; whole?: boolean; k: number } | null;
	pins: Pin[];
	turns: Turn[];
	sessionId: string | null;
	running: string | null;
	versions: Commit[];
	releases: Release[];
	preview: Commit | null;
	/** 되돌릴 수 있는 걸음 수 · 다시 할 수 있는 걸음 수 — 제목 줄 단추가 켜고 끈다 */
	hist: { u: number; r: number };
	busy: string | null;
	/** busy 와 달리 화면을 막지 않는 일. 프로젝트를 닫아도 남는다 */
	jobs: Job[];
	toast: { text: string; kind: "ok" | "err"; action?: { label: string; run: () => void }; sticky?: boolean } | null;
	frames: Set<Window>;
	/** 판 비교 — 고른 판(base)과 지금. 켜져 있으면 무대가 비교 렌즈, 쪽 목록이 바뀐 쪽을 보인다 */
	vdiff: VersionDiff | null;
	/** 비교 렌즈에 바뀐 곳(빨간 덧칠)을 그린다 */
	vdiffMask: boolean;
	/** 앱 밖 Claude Code 가 CLI 로 마지막에 다룬 덱 · 때 · 명령 (remote.ts touch). OUTSIDE_MS 안이면 그 덱에서 보내기 전에 한 번 묻는다 */
	outside: { dir: string; at: number; cmd: string } | null;

	openProject: (dir: string) => Promise<void>;
	closeProject: () => Promise<void>;
	setCurrent: (i: number) => void;
	setFlow: (on: boolean) => void;
	setTool: (t: Tool | "select" | "sketch") => void;
	mentionSlide: (no: number) => void;
	refill: (text: string) => void;
	addSlide: (at: number) => Promise<void>;
	duplicateSlide: (i: number) => Promise<void>;
	moveSlide: (from: number, to: number) => void;
	removeSlide: (i: number) => void;
	addPin: (p: Omit<Pin, "id" | "at">) => string;
	updatePin: (id: string, text: string) => void;
	removePin: (id: string) => void;
	/** force — 앱 밖 Claude Code 가 방금 이 덱을 다뤘어도 보낸다 (알림의 「그래도 보내기」) */
	send: (text: string, attachments?: string[], force?: boolean) => Promise<void>;
	stop: () => void;
	applyDirect: (slideId: string, path: number[] | null, op: Op) => Promise<void>;
	/** 손으로 고친 것(끌기 · 방향키 이동 · 글 고치기 · 지우기)을 한 걸음 되돌린다 (Ctrl+Z) · 다시 한다 (Ctrl+Y) */
	undo: () => Promise<void>;
	redo: () => Promise<void>;
	refreshVersions: () => Promise<void>;
	setPreview: (c: Commit | null) => void;
	restore: (c: Commit) => Promise<void>;
	exportTo: (path: string, exact?: boolean) => Promise<void>;
	release: (name: string, notes: string) => Promise<void>;
	/** action 이 있거나 sticky 면 사용자가 닫을 때까지 둔다 */
	notify: (text: string, kind?: "ok" | "err", opt?: { action?: { label: string; run: () => void }; sticky?: boolean }) => void;
	/** 못 찾은 글꼴을 Claude 에게 맡긴다 — 사용자가 알림의 「맡기기」를 눌렀을 때만 부른다 */
	fixFonts: (missing: string[]) => Promise<void>;
	saveDeck: (deck: Deck) => Promise<void>;
	/** 고른 판과 지금을 견준다. base 가 없으면 직전 판 */
	startCompare: (base?: Commit) => Promise<void>;
	closeCompare: () => void;
	/** 비교 중인 판에서 이 쪽만 되돌린다 (지금 없는 쪽이면 되살린다) — 한 판으로 남긴다 */
	restoreSlide: (slideId: string) => Promise<void>;
	/** 요청칸에 @v<n> 을 넣는다 */
	mentionVersion: (n: number) => void;
	fixDiff: (report: Report) => void;
}

let unlisten: (() => void)[] = [];
/** 이 앱을 켜 둔 동안 글꼴을 물어본 프로젝트 — 열 때마다 같은 것을 다시 묻지 않는다 */
const fontAsked = new Set<string>();
let directTimer: ReturnType<typeof setTimeout> | undefined;
// 되돌리기 — 손으로 고치기 전의 슬라이드 파일 글을 쌓는다. 파일을 통째로 되쓰면 감시가 쪽을 다시 그린다.
// Claude 턴 · 판 되돌리기 · 다른 덱 열기 때 비운다 — 그 뒤에 옛 글을 되쓰면 Claude 가 고친 것이 함께 사라진다.
// Claude 의 턴 자체는 「판」으로 되돌린다
type Snap = { file: string; text: string };
let undoStack: Snap[] = [];
let redoStack: Snap[] = [];
const UNDO_MAX = 100;
// 쌓임은 모듈 변수라 화면이 모른다 — 바뀔 때마다 걸음 수를 상태로 알린다
const syncHist = () => useDeck.setState({ hist: { u: undoStack.length, r: redoStack.length } });
const clearUndo = () => { undoStack = []; redoStack = []; syncHist(); };
// 손 편집 · 되돌리기는 한 줄로 차례대로 돈다 — 방향키 이동을 쓰는 중에 Ctrl+Z 가 같은 파일을 읽고 쓰면 하나가 다른 것을 덮는다
let queue: Promise<unknown> = Promise.resolve();
const serial = (f: () => Promise<void>) => { const r = queue.then(f, f); queue = r.catch(() => {}); return r; };

let compareTimer: ReturnType<typeof setTimeout> | undefined;
/** 비교 중에 파일이 바뀌면(Claude 턴 · 손 편집 · 되돌리기) 잠잠해진 뒤 다시 견준다 */
function refreshCompare(get: () => S, set: (p: Partial<S>) => void) {
	clearTimeout(compareTimer);
	compareTimer = setTimeout(async () => {
		const { dir, id, deck, vdiff } = get();
		if (!deck || !vdiff) return;
		const next = await diffVersion(dir, id, deck, vdiff.base).catch(() => null);
		if (next && get().vdiff?.base.hash === vdiff.base.hash) set({ vdiff: next });
	}, 800);
}

/**
 * 내보낸 PPTX 를 PowerPoint 로 그려 웹과 견준다 — 화면을 막지 않는 뒤 일(jobs)로. 같으면 한 줄, 다르거나 그림으로 굳은 곳이 있으면
 * 그 쪽 번호와 「차이 고치기」를 알린다. PowerPoint 가 없는 PC 에서는 확인하지 못했다고만 알린다.
 * 2026.11.24 : 무대의 「비교」(PowerPoint 대조 렌즈)를 걷고 여기로 옮겼다 — 사용자가 바라는 것은 늘 「완전히 같다」라서, 켜서 볼 화면보다 내보낼 때 저절로 확인하는 편이 맞다.
 */
function verifyPptx(get: () => S, deck: Deck, built: Built) {
	const { dir, id, versions } = get();
	const job = "verify" + Date.now().toString(36);
	const note = (n: string) => useDeck.setState((st) => ({
		jobs: st.jobs.some((j) => j.id === job) ? st.jobs.map((j) => (j.id === job ? { ...j, note: n } : j)) : [...st.jobs, { id: job, label: tNow("verifying"), i: 0, n: 0, note: n }],
	}));
	note("PowerPoint");
	runCheck(dir, id, deck, versions[0]?.n ?? 0, note, built)
		.then((report) => {
			if (get().dir !== dir) return;
			const bad = report.slides.filter(needsFix);
			if (!bad.length) return get().notify(tNow("pptxSame"), "ok");
			// 모양이 다른 쪽이 먼저다. 그림으로 굳은 곳만 있으면(돌린 배지처럼 일부러 쓴 효과일 수 있다) 알리기만 하고 붉게 칠하지 않는다
			const differ = bad.filter((x) => x.score > SAME).map((x) => x.no);
			const stiff = bad.filter((x) => x.locked?.length).map((x) => x.no);
			const msg = [differ.length ? `${tNow("pptxDiffers")} ${differ.join(" · ")}` : "", stiff.length ? `${tNow("lockedSlides")} ${stiff.join(" · ")}` : ""].filter(Boolean).join(". ");
			get().notify(msg, differ.length ? "err" : "ok", { action: { label: tNow("fixDiff"), run: () => get().fixDiff(report) } });
		})
		.catch((e) => { if (get().dir === dir) get().notify(`${tNow("pptxNoCheck")}. ${String(e)}`, "err"); })
		.finally(() => { useDeck.setState((st) => ({ jobs: st.jobs.filter((j) => j.id !== job) })); });
}

/** 손으로 고친 것은 몇 번이고 이어서 하므로 잠잠해지면 한 판으로 묶는다. 그새 턴이 돌면 끝난 뒤로 미룬다 */
function directCommit(dir: string, get: () => S) {
	clearTimeout(directTimer);
	const flush = async () => {
		if (get().dir !== dir) return;
		if (get().running) { directTimer = setTimeout(flush, 2000); return; }
		await api.commit(dir, tNow("direct")).catch(() => null);
		get().refreshVersions();
	};
	directTimer = setTimeout(flush, 4000);
}

/** from 에서 하나 꺼내 그 파일을 되쓰고, 지금 글은 to 에 쌓는다 — undo · redo 가 같은 길을 반대로 쓴다 */
async function step(get: () => S, from: Snap[], to: Snap[]) {
	const { dir, deck } = get();
	if (!dir || !deck || get().preview) return;
	if (get().running) return get().notify(tNow("working"), "err");
	const snap = from.pop();
	if (!snap) return;
	const now = await api.readText(dir, snap.file).catch(() => null);
	await api.writeText(dir, snap.file, snap.text);
	if (now != null) to.push({ file: snap.file, text: now });
	syncHist();
	// 되돌린 쪽이 다른 쪽이면 그 쪽으로 간다 — 보이지 않는 곳에서 바뀌면 되돌렸는지 알 수 없다
	const i = deck.slides.findIndex((x) => x.file === snap.file);
	if (i >= 0 && i !== get().current) get().setCurrent(i);
	directCommit(dir, get);
}

/** 앱 밖 Claude Code 의 마지막 명령 뒤 이 시간 안이면 그 덱에서 보내기 전에 묻는다.
 *  2026.11.25 : 5분. 바깥 세션은 파일을 고치는 몇 분 동안 CLI 를 부르지 않기도 해서 짧게 잡으면 한창 고치는 중에 풀린다 */
export const OUTSIDE_MS = 5 * 60 * 1000;
/** CLI 가 주는 경로(D:\…)와 앱이 쥔 경로를 견준다 — 빗금 · 대소문자 · 끝 빗금이 달라도 같은 폴더 */
export const sameDir = (a: string, b: string) => {
	const n = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
	return !!a && !!b && n(a) === n(b);
};

const persistPins = (dir: string, pins: Pin[]) => api.writeText(dir, ".claudeppt/pins.json", JSON.stringify(pins, null, 1)).catch(() => {});
const persistTalk = (dir: string, turns: Turn[], sessionId: string | null) =>
	api.writeText(dir, ".claudeppt/talk.json", JSON.stringify({ sessionId, turns: turns.map((t) => (t.status === "running" ? { ...t, status: "stopped" } : t)) }, null, 1)).catch(() => {});
const readJson = async <T,>(dir: string, rel: string, d: T): Promise<T> => {
	try { return JSON.parse(await api.readText(dir, rel)); } catch { return d; }
};

/** Claude 가 고친 파일 경로를 프로젝트 기준 상대 경로로 */
const relOf = (dir: string, p?: string) => {
	if (!p) return undefined;
	const a = p.replace(/\\/g, "/"), d = dir.replace(/\\/g, "/").replace(/\/$/, "") + "/";
	return a.toLowerCase().startsWith(d.toLowerCase()) ? a.slice(d.length) : a;
};

export const useDeck = create<S>()((set, get) => ({
	dir: "",
	id: "",
	deck: null,
	rev: {},
	current: 0,
	mode: "edit",
	flow: (() => { try { return localStorage.getItem("claudeppt.flow") === "1"; } catch { return false; } })(),
	tool: "select",
	insertReq: null,
	pins: [],
	turns: [],
	sessionId: null,
	running: null,
	versions: [],
	releases: [],
	preview: null,
	hist: { u: 0, r: 0 },
	busy: null,
	jobs: [],
	toast: null,
	frames: new Set(),
	vdiff: null,
	vdiffMask: true,
	outside: null,

	openProject: async (dir) => {
		await get().closeProject();
		const deck = await readDeck(dir);
		const id = await api.open(dir);
		await api.vcsInit(dir);
		const pins = await readJson<Pin[]>(dir, ".claudeppt/pins.json", []);
		const talk = await readJson<{ sessionId: string | null; turns: Turn[] }>(dir, ".claudeppt/talk.json", { sessionId: null, turns: [] });
		const releases = await readJson<Release[]>(dir, "releases/releases.json", []);
		clearUndo();
		set({ dir, id, deck, rev: {}, current: 0, mode: "edit", tool: "select", pins, turns: talk.turns, sessionId: talk.sessionId, versions: [], releases, preview: null, vdiff: null });
		useSettings.getState().remember(dir);
		// 처음 여는 프로젝트(가져오기 직후)면 첫 판을 남긴다
		const log = await api.log(dir, 1);
		if (!log.length) await api.commit(dir, deck.source?.kind === "pptx" ? "PPTX 가져옴" : "새로 만듦");
		await get().refreshVersions();
		unlisten.push(
			await listen<{ id: string; paths: string[] }>("deck-fs", async (e) => {
				if (e.payload.id !== get().id) return;
				const paths = e.payload.paths;
				if (paths.includes("deck.json")) {
					try { set({ deck: await readDeck(get().dir) }); } catch { /* 쓰는 도중 — 다음 사건에서 다시 읽는다 */ }
				}
				const deck = get().deck;
				if (!deck) return;
				const rev = { ...get().rev };
				const now = Date.now();
				let all = false;
				for (const p of paths) {
					const s = deck.slides.find((s) => s.file === p);
					if (s) rev[s.id] = now;
					else if (p.startsWith("assets/") && !p.startsWith("assets/fonts/")) all = true;
				}
				if (all) for (const s of deck.slides) rev[s.id] = now;
				if (paths.some((p) => p.endsWith(".css"))) for (const w of get().frames) tell(w, { t: "css" });
				set({ rev });
				if (get().vdiff) refreshCompare(get, set);
			}),
		);
		unlisten.push(
			await listen<{ turn: string; line: string }>("claude", (e) => {
				const { turn, line } = e.payload;
				let m: any;
				try { m = JSON.parse(line); } catch { return; }
				// 지금 이 프로젝트에서 돌고 있는 턴의 사건만 받는다 — 다른 턴의 세션 id 가 섞이면 다음 턴이 엉뚱한 대화를 잇는다
				if (turn !== get().running) return;
				const patch = (fn: (t: Turn) => Turn) => set({ turns: get().turns.map((t) => (t.id === turn ? fn(t) : t)) });
				if (m.type === "system" && m.subtype === "init" && m.session_id) set({ sessionId: m.session_id });
				else if (m.type === "stream_event" && m.event?.type === "content_block_delta" && m.event.delta?.type === "text_delta") {
					patch((t) => ({ ...t, reply: t.reply + m.event.delta.text }));
				} else if (m.type === "stream_event" && m.event?.type === "message_start") {
					// 도구를 쓴 뒤 새 말 덩이 — 앞 덩이와 띄운다
					patch((t) => ({ ...t, reply: t.reply && !t.reply.endsWith("\n\n") ? t.reply + "\n\n" : t.reply }));
				} else if (m.type === "assistant") {
					const uses = (m.message?.content || []).filter((c: any) => c.type === "tool_use");
					if (uses.length) patch((t) => ({ ...t, tools: [...t.tools, ...uses.map((u: any) => ({ name: u.name, file: relOf(get().dir, u.input?.file_path || u.input?.path || u.input?.pattern) }))] }));
				} else if (m.type === "result") {
					if (m.session_id) set({ sessionId: m.session_id });
					patch((t) => ({ ...t, cost: m.total_cost_usd, reply: (t.reply.trim() || m.result || "").trim(), error: m.is_error ? m.result || "error" : t.error }));
				}
			}),
		);
		// 글꼴 잇기 — 화면을 막지 않고 뒤에서 한다 (깔린 글꼴을 처음 읽을 때 몇 초 걸린다).
		// 폴더 감시 사건을 받기 시작한 뒤에 돌린다. 2026.11.20 : 전에는 받기 전에 돌려, 글꼴 목록을 이미 읽어 둔 두 번째 가져오기에서
		// theme.css 를 먼저 고쳐 버렸다 — 그 사건을 놓친 쪽들이 대체 글꼴로 남아 「목차」가 두 줄로 꺾였다.
		// 고쳤으면 쪽을 다시 띄운다 — 새 @font-face 를 CSS 다시 읽기만으로는 이미 그린 글자에 늦게 입히는 일이 있어 확실히 한다
		linkFonts(dir, deck).then(({ missing, changed }) => {
			if (get().dir !== dir) return;
			if (changed) {
				const now = Date.now(), rev = { ...get().rev };
				for (const s of get().deck?.slides || []) rev[s.id] = now;
				set({ rev });
			}
			if (!missing.length || fontAsked.has(dir)) return;
			fontAsked.add(dir);
			const list = missing.slice(0, 4).join(" · ") + (missing.length > 4 ? ` 외 ${missing.length - 4}개` : "");
			get().notify(`이 PC 에 없는 글꼴 ${missing.length}개: ${list}. Claude 에게 글꼴 설정을 맡길까요?`, "ok", { action: { label: "맡기기", run: () => get().fixFonts(missing) } });
		}, () => {});
	},

	closeProject: async () => {
		// 턴이 도는 중에 닫으면 끝난 턴이 다음에 연 프로젝트의 덱 · 대화를 덮어쓴다 — 먼저 멈추고 끝나기를 기다린다
		if (get().running) {
			get().stop();
			while (get().running) await new Promise((r) => setTimeout(r, 200));
		}
		clearTimeout(directTimer);
		unlisten.forEach((f) => f());
		unlisten = [];
		const { id } = get();
		if (id) await api.close(id).catch(() => {});
		set({ dir: "", id: "", deck: null, turns: [], pins: [], versions: [], preview: null, running: null, vdiff: null });
	},

	setCurrent: (i) => set({ current: Math.max(0, Math.min(i, (get().deck?.slides.length || 1) - 1)) }),

	setTool: (tool) => {
		const mode: Mode = tool === "select" ? "edit" : "pin";
		// 2026.11.20 : 이어 보기에서도 긋는다 — 여러 쪽을 훑으며 의견을 다는 일이 잦고, 이어 보기의 쪽은 무대 너비만큼 커서 자리가 거칠지 않다.
		//              (전에는 긋는 도구를 고르면 한 쪽 보기로 돌아갔다)
		// 스케치는 한 쪽 보기에서만 그린다 — 판이 쪽 하나를 덮어 쓰므로 이어 보기면 접는다
		if (tool === "sketch" && get().flow) get().setFlow(false);
		set({ tool, mode });
		for (const w of get().frames) tell(w, { t: "mode", mode });
	},
	setFlow: (flow) => {
		set({ flow });
		try { localStorage.setItem("claudeppt.flow", flow ? "1" : "0"); } catch {}
	},
	mentionSlide: (no) => set({ insertReq: { text: `@${no}`, k: Date.now() } }),
	refill: (text) => set({ insertReq: { text, whole: true, k: Date.now() } }),

	// 쪽을 빼도 HTML 파일은 남긴다 — 지난 판 미리 보기 · 되돌리기가 그 파일을 읽는다
	addSlide: async (at) => {
		const { dir, deck } = get();
		if (!deck) return;
		const id = newId();
		await api.writeText(dir, `slides/${id}.html`, slideHtml(`<section class="slide"></section>`, useSettings.getState().s.lang));
		const s = [...deck.slides];
		s.splice(at, 0, { id, file: `slides/${id}.html` });
		await get().saveDeck({ ...deck, slides: s });
		get().setCurrent(at);
	},
	duplicateSlide: async (i) => {
		const { dir, deck } = get();
		const src = deck?.slides[i];
		if (!deck || !src) return;
		const id = newId();
		// 같은 slides/ 폴더에 두므로 그림 · CSS 의 상대 경로가 그대로 맞는다
		await api.writeText(dir, `slides/${id}.html`, await api.readText(dir, src.file));
		const s = [...deck.slides];
		s.splice(i + 1, 0, { ...src, id, file: `slides/${id}.html` });
		await get().saveDeck({ ...deck, slides: s });
		get().setCurrent(i + 1);
	},
	/** to 는 「이 자리 앞에」 — 끌어 놓기가 주는 값 그대로다 */
	moveSlide: (from, to) => {
		const deck = get().deck;
		if (!deck || from === to || from + 1 === to) return;
		const s = [...deck.slides];
		const [x] = s.splice(from, 1);
		s.splice(to > from ? to - 1 : to, 0, x);
		get().saveDeck({ ...deck, slides: s });
		get().setCurrent(to > from ? to - 1 : to);
	},
	removeSlide: (i) => {
		const deck = get().deck;
		if (!deck || deck.slides.length < 2) return;
		get().saveDeck({ ...deck, slides: deck.slides.filter((_, k) => k !== i) });
		get().setCurrent(Math.min(get().current > i ? get().current - 1 : get().current, deck.slides.length - 2));
	},

	addPin: (p) => {
		const pin: Pin = { ...p, id: Math.random().toString(36).slice(2, 9), at: Date.now() };
		const pins = [...get().pins, pin];
		set({ pins });
		persistPins(get().dir, pins);
		return pin.id;
	},
	updatePin: (id, text) => {
		const pins = get().pins.map((p) => (p.id === id ? { ...p, text } : p));
		set({ pins });
		persistPins(get().dir, pins);
	},
	removePin: (id) => {
		const pins = get().pins.filter((p) => p.id !== id);
		set({ pins });
		persistPins(get().dir, pins);
	},

	send: async (text, attachments = [], force = false) => {
		const { dir, deck, pins, running, current } = get();
		if (!deck || running) return;
		if (!text.trim() && !pins.length && !attachments.length) return;
		// 앱 밖 Claude Code 가 방금 이 덱을 다뤘으면 한 번 묻는다 — 그쪽이 고치던 파일이 이 턴의 판에 섞이고, 같은 쪽을 둘이 고치면 한쪽이 덮인다.
		// 요청칸은 보내며 비워지므로 글을 되돌려 놓는다
		const out = get().outside;
		if (!force && out && sameDir(out.dir, dir) && Date.now() - out.at < OUTSIDE_MS) {
			if (text.trim()) get().refill(text);
			const run = () => {
				if (text.trim()) get().refill("");
				get().send(text, attachments, true);
			};
			get().notify(tNow("outsideBusy").replace("{cmd}", out.cmd), "err", { action: { label: tNow("sendAnyway"), run } });
			return;
		}
		clearUndo();
		const s = useSettings.getState().s;
		// 직접 편집이 남아 있으면 먼저 판으로 — Claude 의 판과 섞이지 않게
		clearTimeout(directTimer);
		await api.commit(dir, tNow("direct")).catch(() => {});
		const order = (id: string) => deck.slides.findIndex((x) => x.id === id) + 1;
		const notes: PinNote[] = pins.map((p, i) => ({ n: i + 1, slide: p.slide, slideNo: order(p.slide), x: p.x, y: p.y, text: p.text, target: p.target, shape: p.shape }));
		const cur = deck.slides[current];
		const mentions = mentionsIn(text, deck);
		const versionMentions = versionMentionsIn(text, get().versions);
		const turn: Turn = { id: "t" + Date.now().toString(36), at: Date.now(), request: text.trim(), pins: notes, mentions, versionMentions, attach: attachments.length ? [...attachments] : undefined, reply: "", tools: [], status: "running" };
		set({ turns: [...get().turns, turn], running: turn.id, pins: [] });
		persistPins(dir, []);
		const patch = (fn: (t: Turn) => Turn) => set({ turns: get().turns.map((t) => (t.id === turn.id ? fn(t) : t)) });

		try {
			// 표시가 있으면 그 쪽 그림 위에 그려 붙인다. 못 만들어도 좌표 글은 가므로 턴은 그대로 돈다
			if (notes.some((n) => n.shape)) {
				patch((t) => ({ ...t, phase: tNow("marking") }));
				attachments = [...attachments, ...(await markedPictures(dir, get().id, deck, notes).catch(() => []))];
				patch((t) => ({ ...t, phase: undefined }));
			}
			// 판 멘션 — 그 판 파일을 .claudeppt/versions/v<n>/ 에 펼치고 지금과 다른 쪽을 적어 넘긴다. 못 펼친 판은 번호만이라도 알린다
			const vlines: string[] = [];
			for (const v of versionMentions) {
				const c = get().versions.find((x) => x.hash === v.hash);
				vlines.push(c ? await versionContext(dir, get().id, deck, c).catch((e) => `- @v${v.n}: could not be read (${e})`) : `- @v${v.n}: not found`);
			}
			const r = await api.claudeRun({
				turn: turn.id,
				dir,
				prompt: turnPrompt(text, notes, cur ? { id: cur.id, no: current + 1 } : null, attachments, mentions, vlines),
				system: systemPrompt(s, deck),
				claudePath: s.claude.path,
				model: s.claude.model,
				effort: s.claude.effort,
				resume: get().sessionId,
			});
			const t0 = get().turns.find((t) => t.id === turn.id)!;
			let status: Turn["status"] = t0.status === "stopped" ? "stopped" : r.code === 0 && !t0.error ? "done" : "failed";
			if (status === "failed" && !t0.error) patch((t) => ({ ...t, error: r.stderr.trim().split("\n").slice(-3).join("\n") || `exit ${r.code}` }));
			// 그림 자리 채우기
			const fresh = await readDeck(dir).catch(() => get().deck!);
			set({ deck: fresh });
			if (status !== "stopped" && s.image.provider !== "svg") {
				const errs = await fillGenerated(dir, fresh, s, (p) => patch((t) => ({ ...t, phase: `${tNow("generating")} · ${p}` })));
				if (errs.length) patch((t) => ({ ...t, error: [t.error, ...errs].filter(Boolean).join("\n") }));
			}
			const summary = (text.trim() || notes.map((n) => n.text).join(" · ") || "핀").replace(/\s+/g, " ").slice(0, 72);
			const c = await api.commit(dir, summary).catch(() => null);
			patch((t) => ({ ...t, status, phase: undefined, version: c ? { n: c.n, short: c.short, hash: c.hash } : undefined }));
		} catch (e) {
			patch((t) => ({ ...t, status: "failed", error: String(e) }));
		} finally {
			set({ running: null });
			persistTalk(dir, get().turns, get().sessionId);
			get().refreshVersions();
		}
	},

	stop: () => {
		const r = get().running;
		if (!r) return;
		set({ turns: get().turns.map((t) => (t.id === r ? { ...t, status: "stopped" } : t)) });
		api.claudeStop(r);
	},

	applyDirect: (slideId, path, op) => serial(async () => {
		const { dir, deck } = get();
		const ref = deck?.slides.find((s) => s.id === slideId);
		if (!ref) return;
		// Claude 가 파일을 고치는 중에는 화면의 요소 번호 길이 원본과 어긋날 수 있다 — 받지 않는다
		if (get().running) return get().notify(tNow("working"), "err");
		const before = await api.readText(dir, ref.file).catch(() => null);
		if (!(await applyOp(dir, ref.file, path, op))) return;
		if (before != null) {
			undoStack.push({ file: ref.file, text: before });
			if (undoStack.length > UNDO_MAX) undoStack.shift();
			redoStack = [];
			syncHist();
		}
		directCommit(dir, get);
	}),

	undo: () => serial(() => step(get, undoStack, redoStack)),
	redo: () => serial(() => step(get, redoStack, undoStack)),

	refreshVersions: async () => {
		const { dir } = get();
		if (!dir) return;
		set({ versions: await api.log(dir).catch(() => []) });
	},

	setPreview: (c) => set({ preview: c && c.hash === get().versions[0]?.hash ? null : c, ...(c ? { vdiff: null } : {}) }),

	restore: async (c) => {
		const { dir } = get();
		set({ busy: tNow("restore") });
		clearUndo();
		try {
			await api.restore(dir, c.hash, `v${c.n} 판으로 되돌림`);
			set({ preview: null, vdiff: null, deck: await readDeck(dir) });
			await get().refreshVersions();
		} catch (e) {
			get().notify(String(e), "err");
		} finally {
			set({ busy: null });
		}
	},

	exportTo: async (path, exact = false) => {
		const { deck, id } = get();
		if (!deck) return;
		set({ busy: tNow("exporting") });
		try {
			const b = await buildPptx(deck, id, (i, n) => set({ busy: `${tNow("exporting")} ${i}/${n}` }), exact);
			await api.absWriteBytes(path, b.data);
			// 깔리지 않은 글꼴은 PowerPoint 에서 다른 글꼴로 보인다 — 알린다
			get().notify(path.split(/[\\/]/).pop()! + (b.missingFonts.length ? ` · ${tNow("missingFont")}: ${b.missingFonts.join(", ")}` : ""), b.missingFonts.length ? "err" : "ok");
			// 「모양 그대로」는 쪽 그림이라 견줄 것이 없다
			if (!exact) verifyPptx(get, deck, b);
		} catch (e) {
			get().notify(String(e), "err");
		} finally {
			set({ busy: null });
		}
	},

	release: async (name, notes) => {
		const { dir, deck, id } = get();
		if (!deck) return;
		set({ busy: tNow("release") });
		try {
			let built: Built | null = null;
			const rel = await makeRelease(dir, id, deck, get().releases, name, notes, (i, n) => set({ busy: `${tNow("release")} ${i}/${n}` }), (b) => { built = b; });
			set({ releases: [...get().releases, rel] });
			await get().refreshVersions();
			get().notify(`${rel.tag} · ${rel.name}`, "ok");
			if (built) verifyPptx(get, deck, built);
		} catch (e) {
			get().notify(String(e), "err");
		} finally {
			set({ busy: null });
		}
	},

	notify: (text, kind = "ok", opt = {}) => {
		const sticky = !!(opt.action || opt.sticky);
		set({ toast: { text, kind, action: opt.action, sticky } });
		// 누를 단추가 있거나 꼭 읽어야 할 글이면 사용자가 닫을 때까지 둔다 — 다른 일을 하다 돌아와도 놓치지 않게
		if (!sticky) setTimeout(() => { if (get().toast?.text === text) set({ toast: null }); }, kind === "err" ? 7000 : 3500);
	},

	fixFonts: async (missing) => {
		const { dir, deck } = get();
		if (!deck) return;
		const id = "font" + Date.now().toString(36);
		const note = (n: string) => useDeck.setState((s) => ({
			jobs: s.jobs.some((j) => j.id === id) ? s.jobs.map((j) => (j.id === id ? { ...j, note: n } : j)) : [...s.jobs, { id, label: "글꼴 설정", i: 0, n: 0, note: n }],
		}));
		note("시작");
		try {
			const r = await askClaude(dir, deck, missing, note);
			if (get().dir === dir && !get().running) await api.commit(dir, "글꼴 연결").catch(() => null);
			const parts = [r.installed.length ? `글꼴 파일 ${r.installed.length}개를 설치했습니다` : "설치한 글꼴이 없습니다"];
			if (r.missing.length) parts.push(`아직 없는 글꼴: ${r.missing.join(" · ")}`);
			if (r.reasons.length) parts.push(r.reasons.join(" / "));
			get().notify(parts.join(". "), r.missing.length ? "err" : "ok", { sticky: !!(r.missing.length || r.reasons.length) });
		} catch (e) {
			get().notify(`글꼴 설정에 실패했습니다. ${String(e)}`, "err", { sticky: true });
		} finally {
			useDeck.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
		}
	},

	startCompare: async (base) => {
		const { dir, id, deck } = get();
		if (!deck) return;
		// 손으로 고친 것이 남아 있으면 먼저 판으로 — 「지금」이 판 목록의 맨 위와 같아야 헷갈리지 않는다.
		// 직전 판은 그 뒤에 고른다 — 먼저 고르면 방금 남긴 판 하나를 건너뛴다
		clearTimeout(directTimer);
		if (!get().running) { await api.commit(dir, tNow("direct")).catch(() => null); await get().refreshVersions(); }
		const versions = get().versions;
		const c = base ?? versions[1];
		if (!c || c.hash === versions[0]?.hash) return get().notify(tNow("vsNoBase"), "err");
		try {
			const vdiff = await diffVersion(dir, id, deck, c);
			if (get().dir !== dir) return;
			set({ vdiff, preview: null });
			// 지금 쪽이 그대로면 첫 바뀐 쪽으로 간다
			const cur = deck.slides[get().current];
			if (cur && !vdiff.slides[cur.id]) {
				const k = deck.slides.findIndex((x) => vdiff.slides[x.id]);
				if (k >= 0) get().setCurrent(k);
			}
		} catch (e) {
			get().notify(String(e), "err");
		}
	},

	closeCompare: () => set({ vdiff: null }),

	restoreSlide: async (slideId) => {
		const { dir, id, deck, vdiff } = get();
		if (!deck || !vdiff) return;
		if (get().running) return get().notify(tNow("working"), "err");
		clearUndo();
		clearTimeout(directTimer);
		try {
			await api.commit(dir, tNow("direct")).catch(() => null);
			const next = await restoreSlideFile(dir, id, deck, vdiff, slideId);
			if (next !== deck) await get().saveDeck(next);
			const no = next.slides.findIndex((x) => x.id === slideId) + 1;
			await api.commit(dir, `${no}쪽을 v${vdiff.base.n} 판으로 되돌림`);
			await get().refreshVersions();
			if (no > 0) get().setCurrent(no - 1);
			set({ vdiff: await diffVersion(dir, id, get().deck!, vdiff.base) });
		} catch (e) {
			get().notify(String(e), "err");
		}
	},

	mentionVersion: (n) => set({ insertReq: { text: `@v${n}`, k: Date.now() } }),

	// 고칠 거리가 남은 쪽의 웹 · PPT · 차이 그림과 굳은 요소 자리를 붙여 Claude 에게 고치게 한다.
	// 고칠 곳은 HTML 쪽이다 — PowerPoint 가 같게 그릴 수 있는 꼴(프롬프트 「PPTX export」 절)로 바꾸게 한다.
	// 2026.11.24 : 굳은 요소도 함께 넘긴다. 전에는 「그림이 되는 것은 괜찮다」고 해서, 글 덩어리가 통째 그림이 되어도 고치지 않았다
	fixDiff: (report) => {
		if (!get().deck) return;
		const bad = report.slides.filter(needsFix);
		if (!bad.length) return;
		const lines = bad.map((x) => {
			const parts = [`- slide ${x.no} (slides/${x.id}.html):`];
			if (x.score > SAME) parts.push(`${x.score}% of pixels differ — web ${x.web}, PowerPoint ${x.ppt}, red mask ${x.diff}.`);
			if (x.locked?.length) parts.push(`baked as a non-editable picture (${x.stiff}% of the slide): ${x.locked.map((b) => `<${b.tag}> at x${b.x} y${b.y} ${b.w}×${b.h}px`).join(", ")}.`);
			return parts.join(" ");
		});
		const text = [
			"The exported PPTX is not yet a faithful, editable copy of the web slides. Fix each slide below by changing its HTML/CSS while keeping the same look.",
			"Pixel differences: Read the web picture, the PowerPoint picture and the red difference mask, and find what renders differently in PowerPoint. Typical causes: text that wraps or sits at a different height (give text boxes enough width, use explicit line-height, avoid mixing block children with bare text), fonts not installed on this PC" + (report.missingFonts.length ? ` (missing: ${report.missingFonts.join(", ")})` : "") + ".",
			"Baked elements: the element and everything inside it become one flat picture, so its text and shapes cannot be edited in PowerPoint. This happens with transform/rotation, filter, blend modes, clip-path, mask, text-shadow, vertical writing-mode, background-clip:text and list markers. Rewrite them with editable means (flat colors, solid borders, explicit bullet spans, no effect on text containers) when the same look can be kept; if the effect is essential to the design (a rotated badge, a decorative shape), leave it and say so.",
			...lines,
		].join("\n");
		get().send(text);
	},

	saveDeck: async (deck) => {
		await writeDeck(get().dir, deck);
		set({ deck });
	},
}));

/** 릴리즈 하나 — 남은 변경을 판으로 남기고, PPTX 를 releases/ 에 굽고, 기록 · 태그를 단다.
 *  앱의 「릴리즈」 단추와 바깥 CLI(remote.ts)가 함께 쓴다. prev 는 지금까지의 releases.json */
export async function makeRelease(dir: string, id: string, deck: Deck, prev: Release[], name: string, notes: string, progress: (i: number, n: number) => void, onBuilt?: (b: Built) => void): Promise<Release> {
	await api.commit(dir, tNow("direct")).catch(() => null);
	const log = await api.log(dir);
	const head = log[0];
	// 번호는 git 태그에서 — releases.json 이 지워지거나 어긋나도 같은 r<k> 를 두 번 달지 않는다
	const used = log.flatMap((c) => c.tags).map((t) => Number(/^r(\d+)$/.exec(t)?.[1] || 0));
	const k = Math.max(0, ...used, ...prev.map((r) => +r.tag.slice(1) || 0)) + 1;
	const tag = `r${k}`;
	// 릴리즈가 가리키는 것은 내용 판(head)이다. 릴리즈 판은 PPTX 와 기록만 더한다
	const file = `releases/${tag}-v${head.n}.pptx`;
	const b = await buildPptx(deck, id, progress);
	await api.writeBytes(dir, file, b.data);
	onBuilt?.(b);
	const rel: Release = { name: name.trim() || tag, tag, n: head.n, hash: head.hash, file, notes: notes.trim(), at: new Date().toISOString() };
	await api.writeText(dir, "releases/releases.json", JSON.stringify([...prev, rel], null, 2) + "\n");
	await api.commit(dir, `릴리즈 ${tag} · ${rel.name}`);
	await api.tag(dir, tag);
	return rel;
}
