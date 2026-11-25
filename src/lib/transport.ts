// 화면 ↔ 백엔드 길 하나. 같은 화면이 두 곳에서 돈다.
//   호스트 앱(Tauri)   명령은 invoke · 사건은 listen 그대로
//   협업 브라우저       호스트 앱의 협업 서버(src-tauri/src/collab.rs)로 — 읽기만 /_/rpc 로 받고, 그 밖의 명령은 거절한다.
//                     쓰기(요청 보내기 · 직접 편집 · 의견)는 명령이 아니라 「의도」로 호스트에 넘긴다 (collab.ts)
// 2026.11.25 : 팀 협업을 위해 api.ts 의 invoke 를 이리로 모았다. 호스트 동작은 바뀌지 않는다
import { invoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";

/** 협업 브라우저인가 — Tauri 가 아닌 곳에서 열린 화면 */
export const remote = typeof window !== "undefined" && !(window as any).__TAURI_INTERNALS__;

/** 원격에서 읽기를 허락하는 명령 → 서버 rpc 이름. 덱 폴더(root · dir)는 그 덱의 id 로 바꿔 보낸다 — 서버는 열린 덱 안만 읽는다 */
const READS: Record<string, string> = { fs_read_text: "read", fs_exists: "exists", vcs_log: "log" };

/** 원격 화면이 보고 있는 덱 — 경로를 id 로 바꾸는 데 쓴다 (collab.ts 가 호스트 상태를 받을 때 채운다) */
export const remoteDeck = { dir: "", id: "" };

export class RemoteDenied extends Error {}

async function rpc<T>(cmd: string, args: any): Promise<T> {
	const name = READS[cmd];
	const root = args?.root ?? args?.dir;
	if (!name || !remoteDeck.id || root !== remoteDeck.dir) throw new RemoteDenied(`원격에서는 할 수 없다: ${cmd}`);
	const r = await fetch("/_/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd: name, args: { id: remoteDeck.id, rel: args.rel, limit: args.limit } }) });
	if (!r.ok) throw new Error(await r.text());
	return r.json();
}

export function call<T>(cmd: string, args?: InvokeArgs, opts?: InvokeOptions): Promise<T> {
	return remote ? rpc<T>(cmd, args) : invoke<T>(cmd, args, opts);
}
