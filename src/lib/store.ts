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
/** by — 꽂은 사람 (협업 의견). done — 해결됨 (무대 · 목록에서 감춘다). 바깥 CLI 가 읽는 꼴은 그대로 — 칸만 더했다 */
export interface Pin { id: string; slide: string; x: number; y: number; text: string; target?: PinNote["target"]; shape?: Shape; at: number; by?: string; done?: boolean }
/** 내 핀인가 — 요청칸 위 초안 · 보내기에 드는 것은 내가 꽂은 열린 핀만 (다른 사람 의견은 무대 · 의견 목록에) */
export const isMine = (p: Pin, who: string) => !p.done && (!p.by || p.by === who);
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
	/** queued — 같은 세션의 앞 턴이 돌고 있거나 동시에 돌 수 있는 수가 찼다. 자리가 나면 돈다 */
	status: "queued" | "running" | "done" | "failed" | "stopped";
	cost?: number;
	version?: { n: number; short: string; hash: string };
	error?: string;
	phase?: string;
	/** 보낸 팀원 — 그 기기의 설정 「내 이름」 */
	by?: string;
	/** 이 턴이 이어 쓴 세션 (Session.key) */
	session?: string;
}
/**
 * 대화 세션 하나 — 팀원은 같은 Claude 계정을 쓰므로 세션을 사람마다 두지 않는다.
 * 쪽은 처음 고친 세션으로 확정되고(bind), 그 뒤 누가 그 쪽을 고치든 그 세션을 이어 쓴다. 세션 하나가 여러 쪽을 맡을 수 있다.
 * key 는 앱이 붙인 이름(s1 · s2 …), claude 는 Claude Code 의 세션 id (첫 턴이 돌아야 생긴다)
 */
export interface Session { key: string; claude: string | null; at: number }
/** 협업 브라우저에서 온 요청 — by 는 서버가 정한 기기 이름. onStart 는 턴이 만들어지자마자(끝나기 전에) 부른다 */
export interface SendFrom { by: string; current: string | null; talkKey: string | null; pins: Pin[]; onStart?: (r: { key: string; via?: number; turn: string }) => void }
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
	sessions: Session[];
	/** 쪽 id → 그 쪽을 처음 고친 세션 key */
	bind: Record<string, string>;
	/** 지금 대화 — 대화칸에 보이는 세션이자, 아직 어느 세션도 고치지 않은 쪽에 대한 요청이 가는 세션.
	 *  마지막에 쓰인 세션 · 「새 대화」로 연 세션 · 세션 목록에서 고른 세션 */
	talkKey: string | null;
	/** 도는 턴이 하나라도 있으면 그중 하나 (직접 편집 · 되돌리기 · 판 되돌리기를 막는 데 쓴다) */
	running: string | null;
	/** 세션 key → 그 세션에서 도는 턴 — 다른 세션끼리는 함께 돈다 */
	runs: Record<string, string>;
	versions: Commit[];
	releases: Release[];
	preview: Commit | null;
	/** 되돌릴 수 있는 걸음 수 · 다시 할 수 있는 걸음 수 — 제목 줄 단추가 켜고 끈다 */
	hist: { u: number; r: number };
	/** 협업: 사람마다 되돌릴 수 있는 걸음 수 (브라우저 팀원의 제목 줄 단추) */
	histBy: Record<string, { u: number; r: number }>;
	/** 협업: 쪽마다 마지막으로 손으로 고친 사람 · 때 — 「○○ 님이 고치는 중」 */
	editing: Record<string, { by: string; at: number }>;
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
	/** by · id — 협업 브라우저 팀원이 꽂은 핀 (그 사람 이름 · 브라우저가 정한 id) */
	addPin: (p: Omit<Pin, "id" | "at" | "by">, by?: string, id?: string) => string;
	updatePin: (id: string, text: string) => void;
	removePin: (id: string) => void;
	/** 의견 해결 · 다시 열기 */
	resolvePin: (id: string, done: boolean) => void;
	/** 의견 하나를 그 쪽의 세션에 보낸다 — 「○○ 님 의견을 반영해 줘」. from 이 없으면 이 기기 사람이 보낸다 */
	sendPin: (id: string, from?: { by: string; talkKey: string | null }) => Promise<void>;
	/** force — 앱 밖 Claude Code 가 방금 이 덱을 다뤘어도 보낸다 (알림의 「그래도 보내기」).
	 *  from — 협업 브라우저 팀원이 보낸 요청 (collab.ts). 보낸 사람 · 그 사람이 보던 쪽 · 그 사람의 지금 대화로 처리하고, 호스트 화면(보는 대화 · 핀)은 건드리지 않는다 */
	send: (text: string, attachments?: string[], force?: boolean, from?: SendFrom) => Promise<void>;
	/** turn 을 주지 않으면 지금 대화의 도는 턴 */
	stop: (turn?: string) => void;
	/** 새 세션을 열어 지금 대화로 삼는다 — 대화칸이 빈 새 대화가 된다 */
	newTalk: () => void;
	/** 그 세션의 대화를 본다 — 지금 대화가 된다 (처음 고치는 쪽이 이 세션으로 간다) */
	viewSession: (key: string) => void;
	/** by — 고친 사람 (협업 브라우저 팀원이면 그 이름, 없으면 이 기기의 이름) */
	applyDirect: (slideId: string, path: number[] | null, op: Op, by?: string) => Promise<void>;
	/** 손으로 고친 것(끌기 · 방향키 이동 · 글 고치기 · 지우기)을 한 걸음 되돌린다 (Ctrl+Z) · 다시 한다 (Ctrl+Y). by 의 걸음만 */
	undo: (by?: string) => Promise<void>;
	redo: (by?: string) => Promise<void>;
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

/** 사건 리스너는 앱에 한 벌만 — 덱을 열 때마다 붙였다 떼면, openProject 가 겹쳐 불릴 때(다시 켠 뒤 덱 열기 + 사용자 클릭) 두 벌 붙어
 *  Claude 글자가 두 번 찍혔다. 받은 사건은 지금 연 덱 것(id) · 지금 도는 턴 것만 쓴다 */
let listening: Promise<unknown> | null = null;
/** 이 앱을 켜 둔 동안 글꼴을 물어본 프로젝트 — 열 때마다 같은 것을 다시 묻지 않는다 */
const fontAsked = new Set<string>();
let directTimer: ReturnType<typeof setTimeout> | undefined;
// 되돌리기 — 손으로 고치기 전의 슬라이드 파일 글을 쌓는다. 파일을 통째로 되쓰면 감시가 쪽을 다시 그린다.
// Claude 턴 · 판 되돌리기 · 다른 덱 열기 때 비운다 — 그 뒤에 옛 글을 되쓰면 Claude 가 고친 것이 함께 사라진다.
// Claude 의 턴 자체는 「판」으로 되돌린다
// 협업: 걸음마다 고친 사람(by)을 단다 — 되돌리기는 사람마다 제 것만 (팀원의 Ctrl+Z 가 다른 사람이 고친 것을 걷지 않게)
// 협업: after 는 그 걸음 직후의 파일 글 — 되돌릴 때 파일이 아직 그 글이어야 되쓴다. 그 사이 다른 사람이 같은 쪽을 고쳤으면
// 파일을 통째로 되쓰면 그 사람이 고친 것까지 사라진다 (2026.11.25 협업 시험에서 찾음) — 그때는 되돌리지 않고 알린다
type Snap = { file: string; text: string; after: string | null; by: string };
let undoStack: Snap[] = [];
let redoStack: Snap[] = [];
const UNDO_MAX = 100;
// 쌓임은 모듈 변수라 화면이 모른다 — 바뀔 때마다 걸음 수를 상태로 알린다
const histOf = (by: string) => ({ u: undoStack.filter((x) => x.by === by).length, r: redoStack.filter((x) => x.by === by).length });
const syncHist = () => {
	const names = new Set([...undoStack, ...redoStack].map((x) => x.by));
	useDeck.setState({ hist: histOf(me()), histBy: Object.fromEntries([...names].map((n) => [n, histOf(n)])) });
};
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
/** 잠잠해지기 전까지 손으로 고친 사람들 — 그 판의 작성자 */
let directBy = new Set<string>();
function directCommit(dir: string, get: () => S, by: string) {
	clearTimeout(directTimer);
	directBy.add(by);
	const flush = async () => {
		if (get().dir !== dir) return;
		if (get().running) { directTimer = setTimeout(flush, 2000); return; }
		const authors = [...directBy].filter(Boolean).join(" · ");
		directBy = new Set();
		await api.commit(dir, tNow("direct"), authors || me()).catch(() => null);
		get().refreshVersions();
	};
	directTimer = setTimeout(flush, 4000);
}

/** from 에서 하나 꺼내 그 파일을 되쓰고, 지금 글은 to 에 쌓는다 — undo · redo 가 같은 길을 반대로 쓴다 */
async function step(get: () => S, from: Snap[], to: Snap[], by: string) {
	const { dir, deck } = get();
	if (!dir || !deck || get().preview) return;
	if (get().running) return get().notify(tNow("working"), "err");
	// 이 사람의 마지막 걸음 — 다른 사람의 걸음은 건너뛴다
	const k = from.map((x) => x.by).lastIndexOf(by);
	if (k < 0) return;
	const [snap] = from.splice(k, 1);
	const now = await api.readText(dir, snap.file).catch(() => null);
	if (snap.after != null && now !== snap.after) {
		syncHist();
		const msg = tNow("undoBlocked");
		if (by !== me()) throw new Error(msg);
		return get().notify(msg, "err");
	}
	await api.writeText(dir, snap.file, snap.text);
	if (now != null) to.push({ file: snap.file, text: now, after: snap.text, by });
	syncHist();
	// 되돌린 쪽이 다른 쪽이면 그 쪽으로 간다 — 보이지 않는 곳에서 바뀌면 되돌렸는지 알 수 없다 (호스트 화면만 — 팀원의 되돌리기로 호스트가 보는 쪽이 넘어가지 않게)
	const i = deck.slides.findIndex((x) => x.file === snap.file);
	if (by === me() && i >= 0 && i !== get().current) get().setCurrent(i);
	markEditing(get, deck.slides[i]?.id, by);
	directCommit(dir, get, by);
}

/** 이 쪽을 지금 손으로 고친 사람 — 협업 화면이 「○○ 님이 고치는 중」을 보인다 */
function markEditing(get: () => S, slideId: string | undefined, by: string) {
	if (!slideId) return;
	useDeck.setState({ editing: { ...get().editing, [slideId]: { by, at: Date.now() } } });
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
/** .claudeppt/talk.json — sessionId 는 세션이 하나뿐이던 때(2026.11.25 전)의 칸. 옛 앱도 읽게 지금 대화의 세션을 적어 둔다 */
type TalkFile = { turns: Turn[]; sessions?: Session[]; bind?: Record<string, string>; talkKey?: string | null; sessionId?: string | null };
export const persistTalk = (dir: string, st: Pick<S, "turns" | "sessions" | "bind" | "talkKey">) => {
	const file: TalkFile = {
		sessions: st.sessions,
		bind: st.bind,
		talkKey: st.talkKey,
		sessionId: st.sessions.find((x) => x.key === st.talkKey)?.claude ?? null,
		turns: st.turns.map((t) => (t.status === "running" ? { ...t, status: "stopped" } : t)),
	};
	return api.writeText(dir, ".claudeppt/talk.json", JSON.stringify(file, null, 1)).catch(() => {});
};
/** 다음 세션 — s1 · s2 … */
export const nextSession = (list: Session[]): Session => ({ key: "s" + (Math.max(0, ...list.map((x) => Number(x.key.slice(1)) || 0)) + 1), claude: null, at: Date.now() });
/** 이 기기를 쓰는 팀원 — 판의 작성자로도 남긴다 */
export const me = () => useSettings.getState().s.me.trim();
/** 새 Claude 세션 id (--session-id) */
const uuid = (): string =>
	crypto.randomUUID?.() ??
	[...crypto.getRandomValues(new Uint8Array(16))]
		.map((b, i) => (i === 6 ? (b & 15) | 64 : i === 8 ? (b & 63) | 128 : b).toString(16).padStart(2, "0"))
		.join("")
		.replace(/^(.{8})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4-");
/** 세션 기록을 잃었을 때 새 세션 앞에 붙일 요약 — 이 세션의 최근 요청 · 답 · 고친 파일과 시킨 사람 (오래된 것부터) */
export function recapOf(turns: Turn[], key: string, skip: string): string {
	const mine = turns.filter((t) => t.session === key && t.id !== skip && t.status !== "running").slice(-8);
	if (!mine.length) return "";
	const cut = (s: string, n: number) => {
		const one = s.replace(/\s+/g, " ").trim();
		return one.length > n ? one.slice(0, n) + "…" : one;
	};
	const lines = mine.map((t) => {
		const files = [...new Set(t.tools.map((x) => x.file).filter(Boolean))];
		return `- ${t.by || "?"}: ${cut(t.request || t.pins.map((p) => p.text).join(" · "), 300)}\n  → ${cut(t.reply || t.error || "", 400)}` + (files.length ? `\n  files: ${files.join(", ")}` : "");
	});
	return `The earlier Claude session for these slides could not be restored. Recent requests in this session, oldest first:\n${lines.join("\n")}\n\n`;
}

/**
 * 이 요청이 갈 세션 — 보내기와 요청칸의 「보낼 곳」 미리보기가 같은 규칙을 쓴다.
 * 요청이 가리키는 쪽(@쪽 → 핀을 꽂은 쪽 → 지금 보는 쪽)을 처음 고친 세션이 있으면 그 세션을 잇는다 — 다른 팀원이 쓰던 세션이어도.
 * 처음 보는 쪽이면 지금 대화(마지막에 쓰인 세션 · 「새 대화」로 연 세션). 세션이 하나도 없으면 key 가 null — 보낼 때 새로 연다.
 * via 는 세션을 정한 쪽의 번호 (지금 대화로 가면 없음)
 */
export function routeOf(st: Pick<S, "deck" | "current" | "pins" | "bind" | "sessions" | "talkKey">, text: string): { key: string | null; via?: number; targets: string[] } {
	const deck = st.deck;
	if (!deck) return { key: null, targets: [] };
	const mentions = mentionsIn(text, deck);
	const cur = deck.slides[st.current];
	const targets = mentions.length ? mentions.map((m) => m.id) : st.pins.length ? st.pins.map((p) => p.slide) : cur ? [cur.id] : [];
	const live = (k?: string) => !!k && st.sessions.some((x) => x.key === k);
	const hit = targets.find((id) => live(st.bind[id]));
	if (hit) return { key: st.bind[hit], via: deck.slides.findIndex((x) => x.id === hit) + 1, targets };
	return { key: live(st.talkKey ?? undefined) ? st.talkKey : null, targets };
}
/** 답 글자 조각을 잠깐(30ms) 모았다 한 번에 넣는다. 조각마다 turns 를 바꾸면 대화 · 쪽 목록이 조각 수만큼 다시 그려진다.
 *  requestAnimationFrame 이 아니라 타이머 — 창을 내리거나 가려도 글자가 쌓이게 */
const pendingText = new Map<string, string>();
let textTimer: ReturnType<typeof setTimeout> | undefined;
function flushText(get: () => S, set: (p: Partial<S>) => void) {
	clearTimeout(textTimer);
	textTimer = undefined;
	if (!pendingText.size) return;
	const add = new Map(pendingText);
	pendingText.clear();
	set({ turns: get().turns.map((t) => (add.has(t.id) ? { ...t, reply: t.reply + add.get(t.id) } : t)) });
}
function queueText(get: () => S, set: (p: Partial<S>) => void, turn: string, text: string) {
	pendingText.set(turn, (pendingText.get(turn) ?? "") + text);
	textTimer ??= setTimeout(() => flushText(get, set), 30);
}

const readJson = async <T,>(dir: string, rel: string, d: T): Promise<T> => {
	try { return JSON.parse(await api.readText(dir, rel)); } catch { return d; }
};

/** Claude 가 고친 파일 경로를 프로젝트 기준 상대 경로로 */
const relOf = (dir: string, p?: string) => {
	if (!p) return undefined;
	const a = p.replace(/\\/g, "/"), d = dir.replace(/\\/g, "/").replace(/\/$/, "") + "/";
	return a.toLowerCase().startsWith(d.toLowerCase()) ? a.slice(d.length) : a;
};

/** 동시에 도는 턴의 가장 많은 수 — Claude 프로세스 · 사용량이 한꺼번에 몰리지 않게 */
const MAX_RUNS = 3;
/** 턴이 고친 파일을 알려 주는 도구 — 함께 돈 턴의 판에 이 파일들만 담는다 */
const EDIT_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
type Waiting = { turn: string; key: string; exec: () => Promise<void>; done: () => void };
/** 기다리는 턴 — 앞에서부터, 그 세션이 비고 자리가 나면 돈다 */
let waiting: Waiting[] = [];
/** 턴 세우기는 한 줄로 — 「도는 중 · 기다리는 턴」을 본 뒤 턴을 세우기까지 판 남기기를 기다리는 틈에 다른 요청(다른 팀원 · 같은 요청 두 번)이
 *  끼어들면 한 세션에 턴 둘이 함께 돌았다 (2026.11.25 협업 시험에서 찾음). 실행은 세션마다 따로 돈다 */
let sendChain: Promise<unknown> = Promise.resolve();

const setRuns = (set: (p: Partial<S>) => void, runs: Record<string, string>) => set({ runs, running: Object.values(runs)[0] ?? null });

function startRun(get: () => S, set: (p: Partial<S>) => void, w: Waiting) {
	setRuns(set, { ...get().runs, [w.key]: w.turn });
	set({ turns: get().turns.map((t) => (t.id === w.turn && t.status === "queued" ? { ...t, status: "running" } : t)) });
	const dir = get().dir;
	w.exec().finally(() => {
		const runs = { ...get().runs };
		delete runs[w.key];
		setRuns(set, runs);
		if (get().dir === dir) {
			persistTalk(dir, get());
			get().refreshVersions();
		}
		w.done();
		pump(get, set);
	});
}

/** 자리가 났다 — 기다리는 턴을 앞에서부터 돌린다 (그 세션이 비어 있고 동시 상한 안이면) */
function pump(get: () => S, set: (p: Partial<S>) => void) {
	for (const w of [...waiting]) {
		const runs = get().runs;
		if (Object.keys(runs).length >= MAX_RUNS) break;
		if (runs[w.key]) continue;
		waiting = waiting.filter((x) => x !== w);
		startRun(get, set, w);
	}
}

/** 요청 한 턴을 세운다 — 세션 고르기 · 턴 만들기. 바로 돌거나 기다린다. 돌려주는 약속은 그 턴이 끝날 때 풀린다 */
async function sendTurn(get: () => S, set: (p: Partial<S>) => void, text: string, attachments: string[], force: boolean, from?: SendFrom): Promise<{ done: Promise<void> } | undefined> {
	const { dir, deck } = get();
	if (!deck) return;
	const deck0 = deck;
	// 협업 팀원의 요청은 그 사람이 보던 쪽 · 그 사람의 핀으로
	const pins = from ? from.pins : get().pins.filter((p) => isMine(p, me()));
	const current = from ? Math.max(0, deck.slides.findIndex((x) => x.id === from.current)) : get().current;
	if (!text.trim() && !pins.length && !attachments.length) return;
	// 누가 보냈는지 남겨야 한다 — 이름이 없으면 보내지 않는다 (요청칸 위에 이름 칸이 뜬다)
	const by = from ? from.by : me();
	if (!by) {
		if (text.trim()) get().refill(text);
		get().notify(tNow("myNameAsk"), "err");
		return;
	}
	// 앱 밖 Claude Code 가 방금 이 덱을 다뤘으면 한 번 묻는다 — 그쪽이 고치던 파일이 이 턴의 판에 섞이고, 같은 쪽을 둘이 고치면 한쪽이 덮인다.
	// 요청칸은 보내며 비워지므로 글을 되돌려 놓는다
	const out = get().outside;
	if (!force && !from && out && sameDir(out.dir, dir) && Date.now() - out.at < OUTSIDE_MS) {
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
	// 직접 편집이 남아 있으면 먼저 판으로 — Claude 의 판과 섞이지 않게. 도는 턴이 있으면 하지 않는다
	// (그동안은 직접 편집을 받지 않아 남은 것이 없고, 하면 도는 턴이 고치던 파일을 「직접 편집」 판에 쓸어 담는다)
	clearTimeout(directTimer);
	if (!get().running) await api.commit(dir, tNow("direct"), by).catch(() => {});
	const order = (id: string) => deck.slides.findIndex((x) => x.id === id) + 1;
	// 다른 사람이 남긴 의견이면 Claude 에게 누구의 의견인지 알린다
	const notes: PinNote[] = pins.map((p, i) => ({ n: i + 1, slide: p.slide, slideNo: order(p.slide), x: p.x, y: p.y, text: p.text, target: p.target, shape: p.shape, by: p.by && p.by !== by ? p.by : undefined }));
	const cur = deck.slides[current];
	const mentions = mentionsIn(text, deck);
	const versionMentions = versionMentionsIn(text, get().versions);
	// 세션 고르기 (routeOf). 보고 있던 대화와 다른 세션으로 가면 알리고, 대화칸도 그 세션으로 옮긴다 — 보낸 요청이 보이게
	const route = routeOf(from ? { ...get(), current, talkKey: from.talkKey, pins } : get(), text);
	let { sessions } = get();
	let key = route.key;
	if (!key) {
		const ns = nextSession(sessions);
		sessions = [...sessions, ns];
		key = ns.key;
		set({ sessions });
	}
	// 이 요청이 가리킨 쪽(@쪽 · 핀 · 보던 쪽)을 바로 이 세션에 붙인다 — 턴이 끝나기 전에 같은 쪽 요청이 오면 다른 세션으로 가서
	// 두 세션이 같은 파일을 함께 고치지 않게 (같은 세션이면 차례로 기다린다). 이미 다른 세션에 붙은 쪽은 그대로
	const claim = { ...get().bind };
	for (const id of route.targets) if (!claim[id]) claim[id] = key;
	set({ bind: claim });
	if (!from && get().talkKey && key !== get().talkKey && route.via) get().notify(tNow("routedTo").replace("{no}", String(route.via)).replace("{n}", key.slice(1)), "ok");
	// 같은 세션의 앞 턴이 돌거나 기다리는 중이면, 또는 동시에 도는 수가 찼으면 기다린다 — 같은 세션은 차례로, 다른 세션끼리는 함께
	const wait = !!get().runs[key] || waiting.some((w) => w.key === key) || Object.keys(get().runs).length >= MAX_RUNS;
	const turn: Turn = { id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: Date.now(), request: text.trim(), pins: notes, mentions, versionMentions, attach: attachments.length ? [...attachments] : undefined, reply: "", tools: [], status: wait ? "queued" : "running", by, session: key };
	// 지금 대화 = 마지막에 쓰인 세션. 팀원의 요청이면 호스트가 보는 대화는 그대로 두고 그 팀원의 핀만 걷는다
	set(from ? { turns: [...get().turns, turn], pins: get().pins.filter((p) => !pins.includes(p)) } : { turns: [...get().turns, turn], pins: get().pins.filter((p) => !pins.includes(p)), talkKey: key });
	persistPins(dir, get().pins);
	persistTalk(dir, get());
	from?.onStart?.({ key, via: route.via, turn: turn.id });
	const patch = (fn: (t: Turn) => Turn) => set({ turns: get().turns.map((t) => (t.id === turn.id ? fn(t) : t)) });

	// 실행 — 자리가 나면 돈다. 세션의 Claude id · 덱은 돌 때 읽는다 (앞 턴이 그 세션을 열었거나 쪽을 바꿨을 수 있다)
	const exec = async () => {
		const session = get().sessions.find((x) => x.key === key)!;
		const deck = get().deck ?? deck0;
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
			// 한 세션을 여러 팀원이 이어 쓰므로 누가 시킨 것인지 알린다 — 「아까 말한 것」이 누구 말인지 가린다
			const prompt = `Request from teammate: ${by}\n\n` + turnPrompt(text, notes, cur ? { id: cur.id, no: current + 1 } : null, attachments, mentions, vlines);
			// 새 세션은 앱이 id 를 정한다 — 턴이 멈춰도 그 세션의 기록을 찾아 덱에 남긴다 (claude.rs)
			const run = (p: string, resume: string | null) =>
				api.claudeRun({ turn: turn.id, dir, prompt: p, system: systemPrompt(s, deck), claudePath: s.claude.path, model: s.claude.model, effort: s.claude.effort, resume, sessionId: resume ? null : uuid() });
			let r = await run(prompt, session.claude);
			// 세션 기록을 claude 쪽에서도 덱에서도 찾지 못했다 (기록 없이 옮겨 온 덱 · 지운 기록 · UUID 가 아닌 옛 id). 그대로 두면 이 세션을 이을 때마다 실패하고
			// 장표의 맥락이 끊긴다 — 이 세션의 지난 요청 · 답을 요약해 앞에 붙여 새 Claude 세션으로 한 번 더 돌린다
			if (session.claude && r.code !== 0 && /No conversation found|requires a valid session ID/i.test(r.stderr) && get().turns.find((t) => t.id === turn.id)?.status !== "stopped") {
				set({ sessions: get().sessions.map((x) => (x.key === key ? { ...x, claude: null } : x)) });
				patch((t) => ({ ...t, error: undefined, reply: "", tools: [], cost: undefined, phase: tNow("sessionRecovering") }));
				r = await run(recapOf(get().turns, key, turn.id) + prompt, null);
				patch((t) => ({ ...t, phase: undefined }));
				get().notify(tNow("sessionRecovered").replace("{n}", key.slice(1)), "ok");
			}
			flushText(get, set);
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
			// 이 턴이 처음 고친 쪽은 이 세션으로 확정한다 — 이미 다른 세션에 확정된 쪽은 그대로 둔다
			const wrote = new Set(get().turns.find((t) => t.id === turn.id)!.tools.filter((x) => x.name === "Write" || x.name === "Edit" || x.name === "MultiEdit").map((x) => x.file));
			const bind = { ...get().bind };
			for (const sl of fresh.slides) if (wrote.has(sl.file) && !bind[sl.id]) bind[sl.id] = key;
			set({ bind });
			const summary = (text.trim() || notes.map((n) => n.text).join(" · ") || "핀").replace(/\s+/g, " ").slice(0, 72);
			// 다른 세션의 턴이 함께 돌고 있으면 이 턴이 고친 파일만 판에 담는다 — 아직 도는 턴이 고치던 파일이 섞이지 않게.
			// 혼자 돌았으면 전처럼 통째로 (그림 채우기가 만든 파일 · 함께 돌던 턴이 남긴 것까지)
			const others = Object.keys(get().runs).filter((k) => k !== key).length > 0;
			const touched = [...new Set(get().turns.find((t) => t.id === turn.id)!.tools.filter((x) => EDIT_TOOLS.includes(x.name)).map((x) => x.file).filter((x): x is string => !!x))];
			const c = await (others ? api.commitPaths(dir, summary, by, touched) : api.commit(dir, summary, by)).catch(() => null);
			patch((t) => ({ ...t, status, phase: undefined, version: c ? { n: c.n, short: c.short, hash: c.hash } : undefined }));
		} catch (e) {
			patch((t) => ({ ...t, status: "failed", error: String(e) }));
		}
	};
	// 약속을 바로 돌려주면 async 함수가 그것을 풀어 끝날 때까지 기다린다 — 감싸서 돌려준다 (턴 세우기 줄이 턴이 끝날 때까지 막혔다)
	return {
		done: new Promise<void>((done) => {
			const w: Waiting = { turn: turn.id, key, exec, done };
			if (wait) waiting.push(w);
			else startRun(get, set, w);
		}),
	};
}

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
	sessions: [],
	bind: {},
	talkKey: null,
	running: null,
	runs: {},
	versions: [],
	releases: [],
	preview: null,
	hist: { u: 0, r: 0 },
	histBy: {},
	editing: {},
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
		const talk = await readJson<TalkFile>(dir, ".claudeppt/talk.json", { turns: [] });
		// 2026.11.25 전 talk.json 은 세션 하나(sessionId)뿐이었다 — 그 세션을 세션 1 로 옮기고 지난 턴을 그 세션에 단다.
		// 쪽 확정(bind)은 비워 둔다 — 그 쪽들은 다음에 고칠 때 지금 대화(= 세션 1)로 가서 확정된다
		const sessions: Session[] = talk.sessions ?? (talk.sessionId ? [{ key: "s1", claude: talk.sessionId, at: 0 }] : []);
		const turns = talk.sessions ? talk.turns : talk.turns.map((t) => ({ ...t, session: t.session ?? sessions[0]?.key }));
		const talkKey = talk.talkKey ?? sessions.at(-1)?.key ?? null;
		const releases = await readJson<Release[]>(dir, "releases/releases.json", []);
		clearUndo();
		set({ dir, id, deck, rev: {}, current: 0, mode: "edit", tool: "select", pins, turns, sessions, bind: talk.bind ?? {}, talkKey, versions: [], releases, preview: null, vdiff: null });
		useSettings.getState().remember(dir);
		// 처음 여는 프로젝트(가져오기 직후)면 첫 판을 남긴다
		const log = await api.log(dir, 1);
		if (!log.length) await api.commit(dir, deck.source?.kind === "pptx" ? "PPTX 가져옴" : "새로 만듦", me());
		await get().refreshVersions();
		listening ??= Promise.all([
			listen<{ id: string; paths: string[] }>("deck-fs", async (e) => {
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
			listen<{ turn: string; line: string }>("claude", (e) => {
				const { turn, line } = e.payload;
				let m: any;
				try { m = JSON.parse(line); } catch { return; }
				// 지금 이 프로젝트에서 돌고 있는 턴의 사건만 받는다 — 다른 턴의 세션 id 가 섞이면 다음 턴이 엉뚱한 대화를 잇는다
				if (!Object.values(get().runs).includes(turn)) return;
				const delta = m.type === "stream_event" && m.event?.type === "content_block_delta" && m.event.delta?.type === "text_delta";
				// 글자가 아닌 사건(새 말 덩이 · 도구 · 끝) 앞에서는 모아 둔 글자를 먼저 넣는다 — 순서가 바뀌지 않게
				if (!delta) flushText(get, set);
				const patch = (fn: (t: Turn) => Turn) => set({ turns: get().turns.map((t) => (t.id === turn ? fn(t) : t)) });
				// Claude Code 의 세션 id 는 이 턴이 이어 쓴 세션에 적는다 — 다음에 그 세션을 이을 때 쓴다
				const keep = (sid: string) => {
					const key = get().turns.find((t) => t.id === turn)?.session;
					if (key) set({ sessions: get().sessions.map((x) => (x.key === key ? { ...x, claude: sid } : x)) });
				};
				if (m.type === "system" && m.subtype === "init" && m.session_id) keep(m.session_id);
				else if (m.type === "stream_event" && m.event?.type === "content_block_delta" && m.event.delta?.type === "text_delta") {
					queueText(get, set, turn, m.event.delta.text);
				} else if (m.type === "stream_event" && m.event?.type === "message_start") {
					// 도구를 쓴 뒤 새 말 덩이 — 앞 덩이와 띄운다
					patch((t) => ({ ...t, reply: t.reply && !t.reply.endsWith("\n\n") ? t.reply + "\n\n" : t.reply }));
				} else if (m.type === "assistant") {
					const uses = (m.message?.content || []).filter((c: any) => c.type === "tool_use");
					if (uses.length) patch((t) => ({ ...t, tools: [...t.tools, ...uses.map((u: any) => ({ name: u.name, file: relOf(get().dir, u.input?.file_path || u.input?.path || u.input?.pattern) }))] }));
				} else if (m.type === "result") {
					if (m.session_id) keep(m.session_id);
					patch((t) => ({ ...t, cost: m.total_cost_usd, reply: (t.reply.trim() || m.result || "").trim(), error: m.is_error ? m.result || "error" : t.error }));
				}
			}),
		]);
		await listening;
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
		if (get().running || waiting.length) {
			for (const w of [...waiting]) get().stop(w.turn);
			for (const id of Object.values(get().runs)) get().stop(id);
			while (get().running) await new Promise((r) => setTimeout(r, 200));
		}
		clearTimeout(directTimer);
		const { id } = get();
		if (id) await api.close(id).catch(() => {});
		set({ dir: "", id: "", deck: null, turns: [], sessions: [], bind: {}, talkKey: null, pins: [], versions: [], preview: null, running: null, runs: {}, vdiff: null });
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

	addPin: (p, by = me(), id) => {
		const pin: Pin = { ...p, id: id && /^[a-z0-9]{4,16}$/.test(id) && !get().pins.some((x) => x.id === id) ? id : Math.random().toString(36).slice(2, 9), at: Date.now(), by: by || undefined };
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
	resolvePin: (id, done) => {
		const pins = get().pins.map((p) => (p.id === id ? { ...p, done: done || undefined } : p));
		set({ pins });
		persistPins(get().dir, pins);
	},
	sendPin: async (id, from) => {
		const p = get().pins.find((x) => x.id === id);
		if (!p) return;
		const by = from?.by ?? me();
		await get().send(tNow("pinSendText").replace("{name}", p.by || by), [], true, { by, current: p.slide, talkKey: from ? from.talkKey : get().talkKey, pins: [p] });
	},

	send: async (text, attachments = [], force = false, from) => {
		const made = sendChain.then(() => sendTurn(get, set, text, attachments, force, from));
		sendChain = made.catch(() => {});
		// 세워졌으면 그 턴이 끝날 때까지 기다린다 (부른 쪽이 끝을 기다리게 — 그림판 · 처음 만들기)
		await (await made)?.done;
	},

	newTalk: () => {
		const { dir, sessions, talkKey, turns } = get();
		if (!dir) return;
		// 지금 대화가 아직 한 번도 쓰이지 않았으면 새로 만들지 않는다 — 빈 세션이 쌓이지 않게
		const cur = sessions.find((x) => x.key === talkKey);
		const ns = cur && !cur.claude && !turns.some((t) => t.session === cur.key) ? cur : nextSession(sessions);
		if (ns !== cur) set({ sessions: [...sessions, ns], talkKey: ns.key });
		persistTalk(dir, get());
		get().notify(tNow("newTalkDone").replace("{n}", ns.key.slice(1)), "ok");
	},

	viewSession: (key) => {
		const { dir, sessions } = get();
		if (!dir || !sessions.some((x) => x.key === key)) return;
		set({ talkKey: key });
		persistTalk(dir, get());
	},

	stop: (turn) => {
		const st = get();
		const r = turn ?? (st.talkKey ? st.runs[st.talkKey] : undefined) ?? st.running;
		if (!r) return;
		set({ turns: get().turns.map((t) => (t.id === r ? { ...t, status: "stopped" } : t)) });
		// 기다리던 턴이면 줄에서 빼고 끝낸다
		const w = waiting.find((x) => x.turn === r);
		if (w) {
			waiting = waiting.filter((x) => x !== w);
			persistTalk(st.dir, get());
			w.done();
			return;
		}
		api.claudeStop(r);
	},

	applyDirect: (slideId, path, op, by = me()) => serial(async () => {
		const { dir, deck } = get();
		const ref = deck?.slides.find((s) => s.id === slideId);
		if (!ref) return;
		// Claude 가 파일을 고치는 중에는 화면의 요소 번호 길이 원본과 어긋날 수 있다 — 받지 않는다
		if (get().running) {
			if (by !== me()) throw new Error(tNow("working"));
			return get().notify(tNow("working"), "err");
		}
		const before = await api.readText(dir, ref.file).catch(() => null);
		if (!(await applyOp(dir, ref.file, path, op))) return;
		if (before != null) {
			const after = await api.readText(dir, ref.file).catch(() => null);
			undoStack.push({ file: ref.file, text: before, after, by });
			if (undoStack.length > UNDO_MAX) undoStack.shift();
			// 새로 고치면 그 사람의 「다시 하기」만 버린다
			redoStack = redoStack.filter((x) => x.by !== by);
			syncHist();
		}
		markEditing(get, slideId, by);
		directCommit(dir, get, by);
	}),

	undo: (by = me()) => serial(() => step(get, undoStack, redoStack, by)),
	redo: (by = me()) => serial(() => step(get, redoStack, undoStack, by)),

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
			await api.restore(dir, c.hash, `v${c.n} 판으로 되돌림`, me());
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
		if (!get().running) { await api.commit(dir, tNow("direct"), me()).catch(() => null); await get().refreshVersions(); }
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
			await api.commit(dir, tNow("direct"), me()).catch(() => null);
			const next = await restoreSlideFile(dir, id, deck, vdiff, slideId);
			if (next !== deck) await get().saveDeck(next);
			const no = next.slides.findIndex((x) => x.id === slideId) + 1;
			await api.commit(dir, `${no}쪽을 v${vdiff.base.n} 판으로 되돌림`, me());
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
	await api.commit(dir, tNow("direct"), me()).catch(() => null);
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
	await api.commit(dir, `릴리즈 ${tag} · ${rel.name}`, me());
	await api.tag(dir, tag);
	return rel;
}
