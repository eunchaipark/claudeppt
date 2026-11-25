// 앱 업데이트 — GitHub 릴리즈의 latest.json 을 보고 새 판이면 내려받아 저절로 설치한다 (docket 과 같은 틀).
// 켤 때 한 번, 켜 둔 동안 1시간마다, 창으로 돌아왔을 때 30분 넘게 안 봤으면 한 번 더. 개발 실행(tauri dev)에서는 자동 확인을 하지 않는다.
// 2026.11.24 : 새 판은 제목 줄 「새 판」 칩으로 알린다 — 처음 찾은 판이면 칩 아래 설명을 저절로 펴고, 닫아도 칩은 설치할 때까지 남는다.
//              전에는 아래 알림 한 줄이라 다른 알림 · 진행 줄과 같은 자리에서 겹치거나 가려져 못 보고 지나갔다.
// 2026.11.25 : 누르지 않아도 설치한다 (설정 「자동 설치」 · 기본 켬). 찾으면 뒤에서 내려받아 두고, 방해되지 않는 때에 설치하고 다시 켠다.
//              다시 켜면 설치하던 때 열려 있던 덱을 다시 연다 (App.tsx resumeAfterUpdate).
//   방해되지 않는 때   앱 안 Claude 가 쉬고 · 화면을 막는 일(내보내기 · 되돌리기)과 뒤 일(가져오기 · 검사)이 없고 ·
//                     앱 밖 Claude Code 가 5분 넘게 이 앱을 부르지 않았고 · 요청칸에 보내지 않은 글 · 첨부가 없고 ·
//                     창을 2분 넘게 떠나 있었거나 5분 넘게 손대지 않았을 때.
//                     글을 고치거나 Claude 의 턴이 도는 중에 앱이 꺼지면 그 일이 끊긴다 — 그래서 사람이 쉬는 틈을 기다린다
// 2026.11.25 : 요청칸에 써 두고 자리를 비우면(창을 2분 떠남) 설치해 다시 켜며 그 글 · 첨부가 사라졌다 — 보내지 않은 글이 있으면 미룬다.
//              바깥 Claude Code 기준(2분)이 보내기 전에 묻는 기준(store OUTSIDE_MS 5분)보다 짧아, 묻는 동안에도 설치될 수 있었다 — 같은 값을 쓴다
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect } from "react";
import { create } from "zustand";
import { useAttach } from "./attach";
import { useSettings } from "./settings";
import { OUTSIDE_MS, useDeck } from "./store";

const CHECK_EVERY_MS = 60 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
/** 창을 떠나 있은 시간 · 손대지 않은 시간 — 이만큼이면 쉬는 틈으로 본다 */
const AWAY_MS = 2 * 60 * 1000;
const IDLE_MS = 5 * 60 * 1000;
/** 앱 밖 Claude Code 의 마지막 명령 뒤 이만큼은 설치하지 않는다 — 그 세션의 다음 명령이 꺼진 앱을 다시 띄우며 엉킨다.
 *  보내기 전에 「앱 밖 Claude Code 가 방금 다뤘다」고 묻는 기준과 같다 */
const OUTSIDE_QUIET_MS = OUTSIDE_MS;
/** 다시 켠 뒤 열 덱 */
export const RESUME_KEY = "claudeppt.resume";

interface U {
	/** ready — 내려받아 두었고 설치만 남았다 */
	phase: "idle" | "checking" | "latest" | "available" | "downloading" | "ready" | "installing" | "error";
	version: string;
	notes: string;
	error: string;
	progress: number;
	notified: boolean;
	checkedAt: number | null;
	run: (silent?: boolean) => Promise<void>;
	/** 지금 설치하고 다시 켠다 (내려받지 않았으면 내려받은 뒤) */
	install: () => Promise<void>;
	dismiss: () => void;
}

let pending: Update | null = null;
let fetching: Promise<boolean> | null = null;

/** 뒤에서 내려받는다 — 이미 받았거나 받는 중이면 그것을 기다린다 */
function fetchUpdate(set: (p: Partial<U>) => void): Promise<boolean> {
	if (!pending) return Promise.resolve(false);
	if (fetching) return fetching;
	const u = pending;
	let total = 0, done = 0;
	set({ phase: "downloading", progress: 0 });
	fetching = u.download((ev) => {
		if (ev.event === "Started") total = ev.data.contentLength || 0;
		if (ev.event === "Progress") { done += ev.data.chunkLength; set({ progress: total ? done / total : 0 }); }
	}).then(
		() => { set({ phase: "ready", progress: 1 }); return true; },
		(e) => { fetching = null; set({ phase: "error", error: String(e) }); return false; },
	);
	return fetching;
}

export const useUpdate = create<U>()((set, get) => ({
	phase: "idle",
	version: "",
	notes: "",
	error: "",
	progress: 0,
	notified: false,
	checkedAt: null,
	run: async (silent) => {
		const ph = get().phase;
		if (ph === "checking" || ph === "downloading" || ph === "ready" || ph === "installing") return;
		if (!silent) set({ phase: "checking", error: "" });
		try {
			const u = await check();
			pending = u;
			fetching = null;
			// 같은 판을 다시 찾았으면 닫아 둔 설명을 또 펴지 않는다
			if (u) {
				set({ phase: "available", version: u.version, notes: u.body || "", notified: get().version !== u.version || get().notified, checkedAt: Date.now() });
				if (useSettings.getState().s.update.install) fetchUpdate(set);
			} else set({ phase: "latest", checkedAt: Date.now() });
		} catch (e) {
			set({ phase: silent ? get().phase : "error", error: String(e), checkedAt: Date.now() });
		}
	},
	install: async () => {
		if (!pending || get().phase === "installing") return;
		if (!(await fetchUpdate(set))) return;
		set({ phase: "installing" });
		// 다시 켠 뒤 같은 덱을 연다
		try {
			const dir = useDeck.getState().dir;
			if (dir) localStorage.setItem(RESUME_KEY, dir); else localStorage.removeItem(RESUME_KEY);
		} catch {}
		try {
			await pending.install();
			await relaunch();
		} catch (e) {
			set({ phase: "error", error: String(e) });
		}
	},
	dismiss: () => set({ notified: false }),
}));

// 쉬는 틈 재기 — 이 창의 손놀림만 센다. 슬라이드 창(iframe) 안의 입력은 이 창에 오지 않으므로, 창에 머물러 있으면 글을 고치는 중일 수 있다고 보고 IDLE_MS 를 길게 잡았다
let lastInput = Date.now();
let leftAt: number | null = null;
const touched = () => { lastInput = Date.now(); };

/** 요청칸에 보내지 않은 글이 있는가 — 요청칸(Talk.tsx)이 알린다. 다시 켜면 그 글이 사라진다 */
let drafting = false;
export const noteDraft = (on: boolean) => { drafting = on; };

/** 지금 설치하면 끊기는 일 — 있으면 그 까닭, 없으면 null */
export function holdsUpdate(): "work" | "draft" | "outside" | null {
	const d = useDeck.getState();
	if (d.running || d.busy || d.jobs.length) return "work";
	// 보내지 않은 요청 글 · 첨부는 다시 켜면 사라진다 (핀은 덱에 남아 그대로다)
	if (drafting || useAttach.getState().files.length) return "draft";
	if (d.outside && Date.now() - d.outside.at < OUTSIDE_QUIET_MS) return "outside";
	return null;
}

/** 지금 설치해도 되는가 — 끊기는 일이 없고, 사람이 쉬는 틈이다 */
function quiet(): boolean {
	if (holdsUpdate()) return false;
	const away = leftAt != null && Date.now() - leftAt >= AWAY_MS;
	// 슬라이드 · 입력칸에 커서가 있으면 손을 놓고 있어도 글을 고치는 중일 수 있다 — 창을 떠날 때까지 기다린다
	const tag = document.activeElement?.tagName;
	const idle = Date.now() - lastInput >= IDLE_MS && tag !== "IFRAME" && tag !== "INPUT" && tag !== "TEXTAREA";
	return away || idle;
}

export function useAutoUpdate(ready: boolean) {
	const auto = useSettings((s) => s.s.update.auto);
	const autoInstall = useSettings((s) => s.s.update.install);
	useEffect(() => {
		if (!ready || !auto || import.meta.env.DEV) return;
		useUpdate.getState().run(true);
		const t = setInterval(() => useUpdate.getState().run(true), CHECK_EVERY_MS);
		// 잠자기 · 오래 다른 창에 있다 오면 타이머가 밀린다 — 돌아온 때 한 번 본다
		const back = () => { const at = useUpdate.getState().checkedAt; if (!at || Date.now() - at > STALE_MS) useUpdate.getState().run(true); };
		addEventListener("focus", back);
		return () => { clearInterval(t); removeEventListener("focus", back); };
	}, [ready, auto]);
	useEffect(() => {
		if (!ready || !autoInstall || import.meta.env.DEV) return;
		const evs = ["pointerdown", "keydown", "wheel"] as const;
		evs.forEach((e) => addEventListener(e, touched, true));
		// 슬라이드 창(iframe)을 누르면 이 창에 blur 가 온다 — 그때는 떠난 것이 아니다. 포커스가 앱 밖으로 갔을 때만 센다
		const blur = () => setTimeout(() => { if (!document.hasFocus()) leftAt = Date.now(); }, 0);
		const focus = () => { leftAt = null; touched(); };
		addEventListener("blur", blur);
		addEventListener("focus", focus);
		if (!document.hasFocus()) leftAt = Date.now();
		// 30초마다 — 받아 두었고 쉬는 틈이면 설치한다
		const t = setInterval(() => {
			const u = useUpdate.getState();
			if (u.phase === "ready" && quiet()) u.install();
		}, 30 * 1000);
		return () => {
			evs.forEach((e) => removeEventListener(e, touched, true));
			removeEventListener("blur", blur);
			removeEventListener("focus", focus);
			clearInterval(t);
		};
	}, [ready, autoInstall]);
}

/** 업데이트로 다시 켰으면 그때 열려 있던 덱을 연다 — 한 번만 */
export async function resumeAfterUpdate() {
	let dir: string | null = null;
	try { dir = localStorage.getItem(RESUME_KEY); localStorage.removeItem(RESUME_KEY); } catch {}
	if (dir && !useDeck.getState().deck) await useDeck.getState().openProject(dir).catch(() => {});
}
