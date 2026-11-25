// 요청 첨부. 요청칸에 붙여 Claude 에게 함께 보내는 파일. 덱의 .claudeppt/attach/ 에 복사해 두고 그 경로를 요청에 적는다 (Claude 의 Read 가 연다).
//
//   들어오는 길   붙여 넣기(Ctrl+V) · 범위 줄의 클립 단추(파일 고르기) · 창에 끌어 놓기(DropZone, 덱이 열려 있으면 첨부로)
//   받는 종류     Claude 의 Read 가 읽는 것만. 그림 · PDF · 글(txt · md · csv · json · html · css · svg). Word · 엑셀 · 한글은 읽지 못해 받지 않는다
//   판           .claudeppt 는 판에 넣지 않는다. 첨부는 대화의 일부라 덱 파일과 섞지 않는다
// 2026.11.25 : 붙여 넣기 그림만 받던 것을 넓혔다. 첨부 목록을 요청칸 안 상태에서 여기로 옮겨 끌어 놓기 판도 넣을 수 있게 했다.
import { create } from "zustand";
import { api, b64FromBytes } from "./api";
import { tNow } from "./i18n";
import { useDeck } from "./store";

export const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
export const TEXT_EXT = ["txt", "md", "csv", "tsv", "json", "html", "htm", "css", "svg", "xml"];
export const ATTACH_EXT = [...IMAGE_EXT, "pdf", ...TEXT_EXT];

const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] || "").toLowerCase();
export const attachable = (name: string) => ATTACH_EXT.includes(extOf(name));
export const isImage = (name: string) => IMAGE_EXT.includes(extOf(name)) || extOf(name) === "svg";

/** 파일 이름. 첨부 폴더 안에서 겹치지 않게 앞에 때를 붙인다. Claude 가 어떤 파일인지 알아보게 원래 이름은 남긴다 */
export const relFor = (name: string) => {
	const safe = name.replace(/[\\/:*?"<>|]+/g, "_").slice(-80) || "file";
	return `.claudeppt/attach/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}-${safe}`;
};
/** 첨부 경로 → 사람이 읽는 이름 (붙인 때 앞머리를 뗀다) */
export const attachName = (rel: string) => rel.split("/").pop()!.replace(/^[a-z0-9]{6,12}-/, "");

interface A {
	files: string[];
	/** 디스크의 파일들. 읽을 수 없는 종류는 빼고 알린다 */
	addPaths: (paths: string[]) => Promise<void>;
	/** 클립보드 · 끌어 놓은 브라우저 파일 */
	addBlobs: (files: File[]) => Promise<void>;
	remove: (rel: string) => void;
	clear: () => void;
}

function refuse(names: string[]) {
	if (names.length) useDeck.getState().notify(`${tNow("attachRefused")}: ${names.join(", ")}`, "err");
}

export const useAttach = create<A>()((set, get) => ({
	files: [],
	addPaths: async (paths) => {
		const dir = useDeck.getState().dir;
		if (!dir) return;
		const bad: string[] = [];
		for (const p of paths) {
			const name = p.split(/[\\/]/).pop() || p;
			if (!attachable(name)) { bad.push(name); continue; }
			const rel = relFor(name);
			try {
				await api.absCopyIn(p, dir, rel);
				set({ files: [...get().files, rel] });
			} catch (e) {
				useDeck.getState().notify(`${name}: ${String(e)}`, "err");
			}
		}
		refuse(bad);
	},
	addBlobs: async (files) => {
		const dir = useDeck.getState().dir;
		if (!dir) return;
		const bad: string[] = [];
		for (const f of files) {
			// 클립보드 그림은 이름이 「image.png」 하나뿐이다. 종류에서 확장자를 얻는다
			const name = f.name && extOf(f.name) ? f.name : `image.${f.type.split("/")[1] || "png"}`;
			if (!attachable(name)) { bad.push(f.name || f.type); continue; }
			const rel = relFor(name);
			await api.writeB64(dir, rel, b64FromBytes(new Uint8Array(await f.arrayBuffer())));
			set({ files: [...get().files, rel] });
		}
		refuse(bad);
	},
	remove: (rel) => set({ files: get().files.filter((x) => x !== rel) }),
	clear: () => set({ files: [] }),
}));

// 다른 덱을 열면 첨부를 비운다. 첨부 파일은 그 덱 폴더 안에 있다
useDeck.subscribe((a, b) => { if (a.dir !== b.dir) useAttach.getState().clear(); });
