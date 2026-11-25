// 프로젝트를 들이는 길 — 새로 만들기 · PPTX 가져오기 · 폴더나 .cppt 열기. 처음 화면과 끌어 놓기가 함께 쓴다.
import { api, join } from "./api";
import { createDeck, readDeck, safeName, writeDeck } from "./deck";
import { linkFonts } from "./fonts";
import { useSettings } from "./settings";
import { me, useDeck } from "./store";
import { tNow } from "./i18n";

/** 저장 폴더 안에서 아직 없는 폴더 이름 — 같은 이름이 있으면 뒤에 번호를 붙인다 */
export async function freeDir(name: string) {
	const lib = useSettings.getState().s.library;
	let n = safeName(name), i = 2;
	const base = n;
	while (await api.exists(lib, n)) n = `${base} ${i++}`;
	return join(lib, n);
}

const titleOf = (brief: string) => {
	const line = brief.trim().split(/\r?\n/)[0];
	return line.length > 48 ? line.slice(0, 46) + "…" : line;
};

export async function startNew(brief: string, template?: string) {
	const s = useSettings.getState().s;
	const title = brief.trim() ? titleOf(brief) : tNow("untitled");
	const dir = await freeDir(title);
	await createDeck(dir, title, s, template);
	await useDeck.getState().openProject(dir);
	if (brief.trim()) useDeck.getState().send(brief.trim());
}

/** PPTX 하나를 저장 폴더에 새 덱으로 들인다 — 첫 판을 남기고, PowerPoint 가 있으면 원본 쪽 그림을 뒤에서 뽑는다.
 *  화면의 가져오기(importFile)와 바깥 CLI(remote.ts)가 함께 쓴다. 덱을 열지는 않는다 */
export async function importDeck(path: string, step: (i: number, n: number) => void) {
	const name = path.split(/[\\/]/).pop()!.replace(/\.pptx$/i, "");
	const dir = await freeDir(name);
	const bytes = new Uint8Array(await api.absReadBytes(path));
	const { importPptx } = await import("./importPptx");
	const { deck, warnings } = await importPptx(bytes, path, dir, name, useSettings.getState().s, step);
	// 글꼴 별칭을 첫 판에 함께 담는다. 2026.11.24 : 열 때만 이어서, 열지 않고 가져온 덱(CLI --no-open)의 쪽 그림 · 내보내기가 대체 글꼴로 가늘게 나왔다
	await linkFonts(dir, deck).catch(() => {});
	// 첫 판은 여기서 남긴다 — 바로 열지 않으면 openProject 의 첫 판 남기기가 늦어져, 아래 「원본 쪽 그림」이 첫 판 이름을 가져간다
	await api.commit(dir, "PPTX 가져옴", me());
	// 원본 쪽 그림 — PowerPoint 가 있으면 뒤에서 뽑는다. 없으면 조용히 넘어간다
	api.pptSnapshot(join(dir, "source", "original.pptx"), join(dir, "source", "pages"), deck.size.w, deck.size.h).then(async (pages) => {
		if (!pages) return;
		// Claude 턴이 도는 중이면 끝나기를 기다린다 — 반쯤 고친 파일이 「원본 쪽 그림」 판에 섞이고 deck.json 을 덮어쓰지 않게
		while (useDeck.getState().running) await new Promise((r) => setTimeout(r, 1000));
		const d = await readDeck(dir);
		d.source = { ...(d.source || { kind: "pptx" }), pages };
		await writeDeck(dir, d);
		await api.commit(dir, "원본 쪽 그림 저장");
		if (useDeck.getState().dir === dir) useDeck.getState().refreshVersions();
	}, () => {});
	return { dir, name, deck, warnings };
}

/** PPTX 가져오기는 화면을 막지 않는다 — 오른쪽 아래 작은 진행 막대(jobs)만 띄우고, 그동안 다른 프로젝트를 보거나 고칠 수 있다.
 *  끝났을 때 아무 프로젝트도 열려 있지 않으면 바로 열고, 무언가 작업 중이면 화면을 빼앗지 않고 알림의 「열기」로 둔다. */
export async function importFile(path: string) {
	const st = useDeck.getState();
	const name = path.split(/[\\/]/).pop()!.replace(/\.pptx$/i, "");
	const id = "imp" + Date.now().toString(36);
	const step = (i: number, n: number) => useDeck.setState((s) => ({
		jobs: s.jobs.some((j) => j.id === id) ? s.jobs.map((j) => (j.id === id ? { ...j, i, n } : j)) : [...s.jobs, { id, label: name, i, n }],
	}));
	step(0, 0);
	try {
		const { dir, warnings } = await importDeck(path, step);
		const ko = useSettings.getState().s.lang === "ko";
		const names: Record<string, [string, string]> = { emf: ["EMF 그림", "EMF images"], chart: ["차트", "charts"], object: ["개체", "objects"], custGeom: ["자유형 도형", "freeform shapes"] };
		const differ = warnings.length ? (ko ? "원본과 다를 수 있음: " : "May differ from original: ") + warnings.map((w) => names[w]?.[ko ? 0 : 1] || w).join(" · ") : "";
		if (!useDeck.getState().deck) {
			await st.openProject(dir);
			if (differ) st.notify(differ);
		} else {
			st.notify(`${name} · ${tNow("imported")}${differ ? " · " + differ : ""}`, "ok", { action: { label: tNow("open"), run: () => useDeck.getState().openProject(dir) } });
		}
	} catch (e) {
		st.notify(`${name} · ${String(e)}`, "err");
	} finally {
		useDeck.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
	}
}

export async function openAny(path: string) {
	const st = useDeck.getState();
	try {
		if (/\.pptx$/i.test(path)) return await importFile(path);
		if (/\.cppt$/i.test(path)) {
			const name = path.split(/[\\/]/).pop()!.replace(/\.cppt$/i, "");
			const dir = await api.unpack(path, await freeDir(name));
			return await st.openProject(dir);
		}
		const dir = /deck\.json$/i.test(path) ? path.replace(/[\\/]deck\.json$/i, "") : path;
		await st.openProject(dir);
	} catch (e) {
		st.notify(String(e), "err");
	}
}
