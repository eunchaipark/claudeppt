// 팀 협업 — 호스트 앱과 협업 브라우저가 같은 덱을 함께 본다 (서버: src-tauri/src/collab.rs, 설계: 「설정 › 협업」).
//
//   호스트(startHost)   덱 · 대화 · 세션 · 판 · 핀을 서버에 올린다(collab_publish). 바뀐 칸만, 턴은 바뀐 턴만.
//                       브라우저가 보낸 「의도」(요청 보내기 · 직접 편집 · 의견)를 받아 호스트 store 로 처리하고 답한다 — 쓰기는 호스트 한 곳
//   브라우저(connect)   /_/ws 로 상태를 받아 store 에 얹는다. 쓰는 동작은 의도로 바꿔 보낸다(REMOTE_ACTIONS).
//                       보는 쪽 · 지금 대화 · 도구 같은 보는 사람 몫은 브라우저마다 따로다
//   접속               누가 붙었고 어느 쪽을 보는지 — useCollab.members. 쪽 목록 · 무대 머리에 보인다
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { call, remote, remoteDeck } from "./transport";
import { tNow } from "./i18n";
import { useSettings } from "./settings";
import { me, type Turn, useDeck } from "./store";

export interface Member { conn: number; device: string; name: string; slide: string | null; host: boolean; since: number }
export interface InviteLink { id: string; url: string; name: string | null; expires: number | null; expired: boolean }
export interface Device { id: string; name: string; seen: number; online: boolean }
/** 서버 정보 — bases: 이 서버에 닿는 주소 · links: 초대 링크 · devices: 링크로 들어온 기기 · locked: 회의 잠금 */
export interface CollabInfo { port: number; bases: string[]; tunnel: { url: string; kind: "tailscale" | "cloudflare" } | null; links: InviteLink[]; devices: Device[]; locked: boolean; members: Member[] }
export interface TunnelTools { tailscale: string | null; cloudflared: string | null }

interface C {
	/** 호스트: 서버가 켜져 있으면 그 정보 */
	info: CollabInfo | null;
	members: Member[];
	/** 브라우저: 서버가 준 내 연결 번호 · 붙어 있는가 */
	conn: number | null;
	connected: boolean;
	/** 브라우저: 호스트가 협업을 껐다 · 나를 내보냈다 */
	ended: boolean;
	kicked: boolean;
}
export const useCollab = create<C>()(() => ({ info: null, members: [], conn: null, connected: false, ended: false, kicked: false }));

/** 호스트와 브라우저가 함께 쓰는 칸 — 나머지(보는 쪽 · 도구 · 비교 · 알림 · 되돌리기 쌓임)는 보는 사람 몫 */
const SHARED = ["dir", "id", "deck", "rev", "sessions", "bind", "talkKey", "versions", "releases", "running", "pins"] as const;
type Key = (typeof SHARED)[number];

// ── 호스트 ──

let lastSet: Partial<Record<Key, unknown>> = {};
let lastTurns = new Set<Turn>();
let lastOrder = "";
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let unsub: (() => void) | null = null;
let hostListening: Promise<unknown> | null = null;

/** 바뀐 칸만 모아 올린다. full 이면 통째 (켤 때) */
function flush(full = false) {
	flushTimer = undefined;
	const st = useDeck.getState() as any;
	const set: Record<string, unknown> = {};
	for (const k of SHARED) if (full || st[k] !== lastSet[k]) { set[k] = st[k]; lastSet[k] = st[k]; }
	const turns: Turn[] = st.turns;
	const order = turns.map((t) => t.id).join(",");
	const put = turns.filter((t) => full || !lastTurns.has(t));
	const patch: any = {};
	if (full) patch.reset = true;
	if (Object.keys(set).length) patch.set = set;
	if (full || order !== lastOrder || put.length) patch.turns = { ...(full || order !== lastOrder ? { order: turns.map((t) => t.id) } : {}), put };
	lastTurns = new Set(turns);
	lastOrder = order;
	if (Object.keys(patch).length) call("collab_publish", { patch }).catch(() => {});
}

/** 글자가 흐르는 동안 매 글자마다 보내지 않게 묶는다 (30ms) */
const schedule = () => { flushTimer ??= setTimeout(() => flush(), 30); };

/** 호스트도 한 사람으로 — 이름과 보는 쪽 */
function hostView() {
	const d = useDeck.getState();
	call("collab_view", { name: me() || "Host", slide: d.deck?.slides[d.current]?.id ?? null }).catch(() => {});
}

export async function startHost(): Promise<CollabInfo> {
	const info = await call<CollabInfo>("collab_start");
	useCollab.setState({ info, members: info.members });
	hostListening ??= Promise.all([
		listen<Member[]>("collab-members", (e) => useCollab.setState({ members: e.payload })),
		listen<CollabInfo>("collab-info", (e) => useCollab.setState({ info: e.payload, members: e.payload.members })),
		listen<{ id: string; from: { conn: number; name: string }; name: string; args: any }>("collab-intent", (e) => handleIntent(e.payload)),
	]);
	await hostListening;
	flush(true);
	hostView();
	// 바깥 길 — 깔린 도구가 있으면 켜자마자 연다(같은 링크가 사무실 안 · 밖에서 열리게). 못 열어도 사무실 망으로는 된다
	if (!info.tunnel) {
		const tools = await collabTools().catch(() => null);
		if (tools && (tools.tailscale || tools.cloudflared)) {
			collabTunnel(true).catch((e) => useDeck.getState().notify(`${tNow("collabTunnelFail")} ${String(e)}`, "err"));
		}
	}
	unsub?.();
	let cur = useDeck.getState().current, deckRef = useDeck.getState().deck;
	unsub = useDeck.subscribe((s) => {
		schedule();
		if (s.current !== cur || s.deck !== deckRef) { cur = s.current; deckRef = s.deck; hostView(); }
	});
	return info;
}

/** 링크 · 기기 · 잠금 — 호스트 화면의 「설정 › 협업」 */
const setInfo = (info: CollabInfo) => { useCollab.setState({ info, members: info.members }); return info; };
export const collabLinkNew = (name: string | null, hours: number | null) => call<CollabInfo>("collab_link_new", { name, hours }).then(setInfo);
export const collabLinkRemove = (id: string) => call<CollabInfo>("collab_link_remove", { id }).then(setInfo);
export const collabKick = (device: string) => call<CollabInfo>("collab_kick", { device }).then(setInfo);
export const collabLock = (on: boolean) => call<CollabInfo>("collab_lock", { on }).then(setInfo);
/** 바깥 길(터널) — 사무실 밖에서도 같은 링크로 (tunnel.rs) */
export const collabTunnel = (on: boolean) => call<CollabInfo>("collab_tunnel", { on }).then(setInfo);
export const collabTools = () => call<TunnelTools>("collab_tools");

/** 호스트 화면을 다시 띄웠는데(새로 고침 · 오류 뒤 다시 그림) 서버가 켜져 있으면 다시 붙는다 — 안 붙으면 브라우저가 멈춘 화면을 본다 */
export async function resumeHost() {
	if (await call("collab_info").catch(() => null)) await startHost();
}

export async function stopHost() {
	unsub?.();
	unsub = null;
	clearTimeout(flushTimer);
	flushTimer = undefined;
	lastSet = {};
	lastTurns = new Set();
	lastOrder = "";
	await call("collab_stop").catch(() => {});
	useCollab.setState({ info: null, members: [] });
}

/** 의도 처리기 — 이름 → (보낸 사람, 인자) → 값. 여기 없는 이름은 거절한다 (서버 INTENTS 와 함께 지킨다) */
const handlers: Record<string, (from: { conn: number; name: string }, args: any) => Promise<unknown>> = {};
export const onIntent = (name: string, fn: (from: { conn: number; name: string }, args: any) => Promise<unknown>) => { handlers[name] = fn; };

async function handleIntent(p: { id: string; from: { conn: number; name: string }; name: string; args: any }) {
	const fn = handlers[p.name];
	let reply: any;
	try {
		reply = fn ? { ok: true, value: (await fn(p.from, p.args ?? {})) ?? null } : { ok: false, error: tNow("collabNotYet") };
	} catch (e) {
		reply = { ok: false, error: String(e) };
	}
	call("collab_reply", { id: p.id, reply }).catch(() => {});
}

// ── 브라우저 ──

let ws: WebSocket | null = null;
let seq = 0;
const waiting = new Map<number, { ok: (v: any) => void; no: (e: Error) => void }>();
const turnMap = new Map<string, Turn>();
let retry = 0;
let kicked = false;

function send(m: unknown) {
	if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

/** 호스트에 하려는 일을 보내고 답을 기다린다 */
export function intent<T = unknown>(name: string, args: unknown = {}): Promise<T> {
	const id = ++seq;
	return new Promise<T>((ok, no) => {
		if (ws?.readyState !== WebSocket.OPEN) return no(new Error(tNow("collabOffline")));
		waiting.set(id, { ok, no });
		send({ t: "intent", id, name, args });
	});
}

/** 이름 · 보는 쪽을 알린다 */
function hello() {
	const d = useDeck.getState();
	send({ t: "hello", name: useSettings.getState().s.me.trim(), slide: d.deck?.slides[d.current]?.id ?? null });
}

function apply(patch: any, full: boolean) {
	const st = useDeck.getState() as any;
	const next: Record<string, unknown> = {};
	if (full || patch.reset) turnMap.clear();
	for (const [k, v] of Object.entries(patch.set ?? {})) {
		// 지금 대화는 보는 사람 몫 — 처음 받을 때와, 보던 세션이 없어졌을 때만 호스트 것을 따른다
		if (k === "talkKey") {
			const sessions = (patch.set.sessions ?? st.sessions) as { key: string }[];
			if (st.talkKey && sessions.some((s) => s.key === st.talkKey)) continue;
		}
		next[k] = v;
	}
	if (patch.turns) {
		for (const t of patch.turns.put ?? []) turnMap.set(t.id, t);
		const order: string[] = patch.turns.order ?? st.turns.map((t: Turn) => t.id);
		for (const id of [...turnMap.keys()]) if (!order.includes(id)) turnMap.delete(id);
		next.turns = order.map((id) => turnMap.get(id)).filter(Boolean);
	}
	if ("dir" in next || "id" in next) {
		remoteDeck.dir = (next.dir as string) ?? st.dir;
		remoteDeck.id = (next.id as string) ?? st.id;
	}
	// 다른 덱으로 바뀌었으면 보는 쪽을 처음으로
	if ("id" in next && next.id !== st.id) next.current = 0;
	if (next.deck && st.current >= (next.deck as any).slides.length) next.current = 0;
	useDeck.setState(next as any);
}

/** 브라우저에서 — 호스트 서버에 붙고, 끊기면 다시 붙는다 */
export function connect() {
	if (!remote || ws) return;
	const open = () => {
		// 한 화면에 연결은 하나 — 개발 중 모듈이 다시 읽히면(HMR) 옛 연결이 남아 같은 사람이 둘로 보였다
		(window as any).__cpptWs?.close();
		ws = (window as any).__cpptWs = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/_/ws`);
		ws.onopen = () => { retry = 0; useCollab.setState({ connected: true, ended: false }); hello(); };
		ws.onmessage = (e) => {
			const m = JSON.parse(e.data);
			if (m.t === "hello") {
				remoteDeck.key = m.deckKey;
				useCollab.setState({ conn: m.conn });
				// 이름은 들어올 때 정한 것(서버가 기기마다 기억) — 요청 · 편집의 보낸 사람도 서버가 이 이름으로 붙인다
				if (m.name && useSettings.getState().s.me !== m.name) useSettings.getState().set((x) => ({ ...x, me: m.name }));
			}
			else if (m.t === "state") apply(m.patch, !!m.full);
			else if (m.t === "members") useCollab.setState({ members: m.list });
			else if (m.t === "reply") {
				const w = waiting.get(m.id);
				waiting.delete(m.id);
				if (w) m.ok ? w.ok(m.value) : w.no(new Error(m.error || "error"));
			} else if (m.t === "bye") useCollab.setState({ ended: true });
			// 내보내졌다 — 보던 덱을 걷고 다시 붙지 않는다 (기기 열쇠가 지워져 붙어도 401 이다)
			else if (m.t === "kicked") { kicked = true; useCollab.setState({ ended: true, kicked: true }); useDeck.setState({ deck: null, turns: [], pins: [] }); }
		};
		ws.onclose = () => {
			ws = null;
			useCollab.setState({ connected: false });
			for (const w of waiting.values()) w.no(new Error(tNow("collabOffline")));
			waiting.clear();
			// 다시 붙기 — 0.5 · 1 · 2 · 4 … 최대 10초
			if (!kicked) setTimeout(open, Math.min(10000, 500 * 2 ** retry++));
		};
	};
	open();
	// 보는 쪽 · 이름이 바뀌면 알린다
	let cur = -1, deckRef: unknown = null;
	useDeck.subscribe((s) => { if (s.current !== cur || s.deck !== deckRef) { cur = s.current; deckRef = s.deck; hello(); } });
	let name = useSettings.getState().s.me;
	useSettings.subscribe((s) => { if (s.s.me !== name) { name = s.s.me; hello(); } });
	useDeck.setState(remoteActions());
}

/** 브라우저의 store 동작 — 쓰는 것은 의도로, 호스트만 하는 것은 막는다. 보는 사람 몫(쪽 옮기기 · 도구 · 세션 보기)은 그대로 */
function remoteActions() {
	const d = useDeck.getState();
	const fail = (e: unknown) => d.notify(String(e instanceof Error ? e.message : e), "err");
	const hostOnly = async () => { d.notify(tNow("collabHostOnly"), "err"); };
	return {
		openProject: hostOnly,
		closeProject: hostOnly,
		send: async (text: string, attachments: string[] = []) => {
			const name = useSettings.getState().s.me.trim();
			if (!name) return d.notify(tNow("myNameAsk"), "err");
			const r = await intent<{ key: string } | null>("send", { text, attachments, pins: useDeck.getState().pins.map((p) => p.id), talkKey: useDeck.getState().talkKey, current: useDeck.getState().deck?.slides[useDeck.getState().current]?.id ?? null }).catch(fail);
			if (r && r.key) useDeck.setState({ talkKey: r.key });
		},
		stop: () => { intent("stop", { turn: useDeck.getState().running }).catch(fail); },
		newTalk: () => { intent<{ key: string }>("newTalk").then((r) => r && useDeck.setState({ talkKey: r.key }), fail); },
		viewSession: (key: string) => useDeck.setState({ talkKey: key }),
		addSlide: hostOnly,
		duplicateSlide: hostOnly,
		moveSlide: () => { hostOnly(); },
		removeSlide: () => { hostOnly(); },
		saveDeck: hostOnly,
		restore: hostOnly,
		restoreSlide: hostOnly,
		exportTo: hostOnly,
		release: hostOnly,
		fixFonts: hostOnly,
		fixDiff: () => { hostOnly(); },
		undo: async () => { await intent("undo").catch(fail); },
		redo: async () => { await intent("redo").catch(fail); },
		applyDirect: async (slideId: string, path: number[] | null, op: unknown) => { await intent("direct", { slideId, path, op }).catch(fail); },
		addPin: (p: any) => { const id = "p" + Date.now().toString(36); intent("pinAdd", { ...p, id }).catch(fail); return id; },
		updatePin: (id: string, text: string) => { intent("pinUpdate", { id, text }).catch(fail); },
		removePin: (id: string) => { intent("pinRemove", { id }).catch(fail); },
	};
}
