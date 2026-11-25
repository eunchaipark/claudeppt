// 백엔드(src-tauri) 명령을 부르는 얇은 층. 이름은 Rust 명령과 같다. 길(Tauri · 협업 브라우저)은 transport.ts 가 고른다.
import { call as invoke, remote } from "./transport";

/** author — 이 판을 시킨 팀원 이름 (직접 편집 · 바깥 CLI 의 판은 ClaudePPT) */
export interface Commit { n: number; hash: string; short: string; date: string; subject: string; tags: string[]; author: string }
export interface LibItem { dir: string; deck: any; modified: number }
/** 설정 「바깥 연결」 — 통로 · 최근 바깥 명령 · 스킬 상태 (control.rs remote_info) */
export interface RemoteInfo {
	enabled: boolean;
	port: number;
	control: string;
	recent: { at: string; cmd: string; dir: string; ok: boolean; error: string | null; ms: number }[];
	skill: { dir: string; installed: boolean; current: boolean; exe: string; linked: string | null };
}
export interface Tool { name: string; path: string | null; version: string }
/** 깔린 글꼴 하나. family = 가족 이름(나라말마다) · full = 전체 이름들 · local = @font-face local() 에 쓸 영어 전체 이름 */
/** metrics = [winAscent, winDescent, typoAscender, typoDescender, typoLineGap] (em 비율) · typo = USE_TYPO_METRICS */
export interface FontFace { file: string; family: string[]; full: string[]; local: string; bold: boolean; italic: boolean; weight: number; metrics: number[]; typo: boolean }

export const api = {
	readText: (root: string, rel: string) => invoke<string>("fs_read_text", { root, rel }),
	clipText: () => invoke<string>("clip_text"),
	writeText: (root: string, rel: string, text: string) => invoke<void>("fs_write_text", { root, rel, text }),
	writeB64: (root: string, rel: string, data: string) => invoke<void>("fs_write_base64", { root, rel, data }),
	exists: (root: string, rel: string) => invoke<boolean>("fs_exists", { root, rel }),
	/** 큰 파일은 base64 를 거치지 않고 날바이트로 — 그림 · 동영상 · 원본 PPTX */
	writeBytes: (root: string, rel: string, data: Uint8Array) => invoke<void>("fs_write_bytes", data, { headers: { "x-root": encodeURIComponent(root), "x-rel": encodeURIComponent(rel) } }),
	absReadBytes: (path: string) => invoke<ArrayBuffer>("abs_read_bytes", { path }),
	absWriteBytes: (path: string, data: Uint8Array) => invoke<void>("abs_write_bytes", data, { headers: { "x-path": encodeURIComponent(path) } }),
	absCopyIn:(src: string, root: string, rel: string) => invoke<void>("abs_copy_in", { src, root, rel }),

	paths: () => invoke<{ data: string; library: string }>("app_paths"),
	settingsLoad: () => invoke<any>("settings_load"),
	settingsSave: (value: unknown) => invoke<void>("settings_save", { value }),
	open: (dir: string) => invoke<string>("project_open", { dir }),
	close: (id: string) => invoke<void>("project_close", { id }),
	library: (dir: string) => invoke<LibItem[]>("library_list", { dir }),
	pack: (dir: string, out: string) => invoke<void>("pack_deck", { dir, out }),
	unpack: (file: string, dest: string) => invoke<string>("unpack_deck", { file, dest }),
	reveal: (path: string) => invoke<void>("reveal", { path }),

	vcsInit: (dir: string) => invoke<void>("vcs_init", { dir }),
	/** author — 이 판을 시킨 팀원 이름. 주면 git 작성자로 남는다 */
	commit: (dir: string, message: string, author?: string) => invoke<Commit | null>("vcs_commit", { dir, message, author: author || null }),
	log: (dir: string, limit?: number) => invoke<Commit[]>("vcs_log", { dir, limit }),
	tag: (dir: string, name: string) => invoke<void>("vcs_tag", { dir, name }),
	restore: (dir: string, hash: string, message: string, author?: string) => invoke<Commit | null>("vcs_restore", { dir, hash, message, author: author || null }),

	claudeDetect: (path: string) => invoke<{ path: string; version: string } | null>("claude_detect", { path }),
	claudeRun: (spec: { turn: string; dir: string; prompt: string; system: string; claudePath: string; model: string; effort: string; resume?: string | null; sessionId?: string | null; mode?: "fonts" }) => invoke<{ code: number; stderr: string }>("claude_run", { spec }),
	claudeStop: (turn: string) => invoke<void>("claude_stop", { turn }),

	toolsDetect: () => invoke<Tool[]>("tools_detect"),
	imageGenerate: (spec: { provider: string; prompt: string; out: string; apiKey?: string; model?: string; size?: string }) => invoke<string>("image_generate", { spec }),
	fontIndex: () => invoke<FontFace[]>("font_index"),
	fontInstall: (urls: string[]) => invoke<{ url: string; files: string[]; error: string | null }[]>("font_install", { urls }),
	remoteInfo: () => invoke<RemoteInfo>("remote_info"),
	skillInstall: () => invoke<RemoteInfo["skill"]>("skill_install"),
	/** dir 안 EMF · WMF 를 긴 변 max 픽셀 PNG 로 바꾼다 (Windows GDI+) — "<너비>x<높이>" */
	metafilePng: (dir: string, src: string, out: string, max = 1600) => invoke<string>("metafile_png", { dir, src, out, max }),
	pptSnapshot: (pptx: string, outDir: string, width = 1280, height = 720) => invoke<number>("ppt_snapshot", { pptx, outDir, width, height }),
};

/** 슬라이드 주소. Windows WebView2 는 사용자 프로토콜을 http://<이름>.localhost 로 연다. 협업 브라우저는 호스트 서버의 /_/deck */
export const deckUrl = (id: string, rel: string, rev?: string) => {
	const base = remote ? `${location.origin}/_/deck` : navigator.userAgent.includes("Windows") ? "http://deck.localhost" : "deck://localhost";
	return `${base}/${id}${rev ? "@" + rev : ""}/${rel.split("/").map(encodeURIComponent).join("/")}`;
};

export const join = (...p: string[]) => p.filter(Boolean).join("\\").replace(/[\\/]+/g, "\\");

export const b64FromBytes = (u8: Uint8Array) => {
	let s = "";
	for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
	return btoa(s);
};
export const bytesFromB64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
