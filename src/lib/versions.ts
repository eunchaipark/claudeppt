// 판 비교 · 쪽 되돌리기 · 판 멘션 — 고른 지난 판과 지금 덱을 쪽마다 견준다.
//
// 목차
//   diffVersion       고른 판과 지금의 쪽 HTML · deck.json · theme.css 를 글로 견주어 바뀐 쪽 · 새 쪽 · 빠진 쪽을 가린다
//   slideMask         한 쪽을 두 판에서 1:1 로 구워 달라진 픽셀을 빨갛게 칠한 그림 (비교 렌즈의 「바뀐 곳」)
//   restoreSlide      한 쪽만 고른 판의 HTML 로 되돌린다 — 지금 없는 쪽이면 그 판의 자리에 되살린다
//   versionContext    @v<n> 멘션 — 그 판의 파일을 .claudeppt/versions/v<n>/ 에 펼쳐 Claude 가 읽게 하고, 지금과 다른 쪽을 알린다
//
// 지난 판 파일은 deck://<id>@<커밋>/<경로> 로 읽는다 (lib.rs serve → git show).
// 그 주소로 받은 HTML 에는 런타임 스크립트가 붙어 온다 — 견주거나 되쓰기 전에 떼어 낸다(stripRt).
// 2026.11.24 : 「비교」를 PowerPoint 대조에서 판 비교로 바꿨다. PowerPoint 대조는 내보내기 · 릴리즈 뒤 자동 확인으로 옮겼다 (store.ts verifyPptx).
import { api, type Commit, deckUrl } from "./api";
import { compare } from "./pixdiff";
import type { Deck } from "./deck";
import { ask, offscreen } from "./frames";

export type SlideState = "changed" | "added";
export interface Removed { id: string; file: string; title?: string; at: number }
export interface VersionDiff {
	base: Commit;
	/** 고른 판의 deck.json */
	past: Deck;
	/** 지금 쪽 id → 고른 판과 다른 점. 같은 쪽은 없다 */
	slides: Record<string, SlideState>;
	/** 고른 판에는 있고 지금은 없는 쪽 — at 은 고른 판에서의 자리(0부터) */
	removed: Removed[];
	/** theme.css 가 다르다 — 모든 쪽 모양이 바뀌었을 수 있다 */
	theme: boolean;
}

const RT = '<script src="/__rt.js"></script>';
const stripRt = (html: string) => html.replace(RT, "");

/** 지난 판의 파일 글. 그 판에 없으면 null */
async function pastText(id: string, hash: string, rel: string): Promise<string | null> {
	const r = await fetch(deckUrl(id, rel, hash)).catch(() => null);
	if (!r?.ok) return null;
	const text = await r.text();
	return rel.endsWith(".html") ? stripRt(text) : text;
}
const nowText = (dir: string, rel: string) => api.readText(dir, rel).catch(() => null);

export async function pastDeck(id: string, hash: string): Promise<Deck> {
	const text = await pastText(id, hash, "deck.json");
	if (text == null) throw new Error("그 판의 deck.json 을 읽지 못했다");
	return JSON.parse(text);
}

export async function diffVersion(dir: string, id: string, deck: Deck, base: Commit): Promise<VersionDiff> {
	const past = await pastDeck(id, base.hash);
	const slides: Record<string, SlideState> = {};
	await Promise.all(deck.slides.map(async (s) => {
		const ref = past.slides.find((p) => p.id === s.id);
		if (!ref) { slides[s.id] = "added"; return; }
		const [a, b] = await Promise.all([pastText(id, base.hash, ref.file), nowText(dir, s.file)]);
		if (a !== b) slides[s.id] = "changed";
	}));
	const nowIds = new Set(deck.slides.map((s) => s.id));
	const removed = past.slides.map((s, at) => ({ id: s.id, file: s.file, title: s.title, at })).filter((s) => !nowIds.has(s.id));
	const [ta, tb] = await Promise.all([pastText(id, base.hash, deck.theme || "theme.css"), nowText(dir, deck.theme || "theme.css")]);
	return { base, past, slides, removed, theme: ta !== tb };
}

/** 한 쪽을 지난 판 · 지금에서 1:1 로 구워 달라진 곳을 빨갛게 칠한 그림(data URL)과 달라진 비율(%) */
export async function slideMask(id: string, file: string, hash: string, w: number, h: number) {
	const shot = async (rev?: string) => {
		const { win, dispose } = await offscreen(id, file, w, h, rev);
		try {
			const r: any = await ask(win, { t: "snapshot", scale: 1 }, 60000);
			if (r.error) throw new Error(r.error);
			return r.data as string;
		} finally { dispose(); }
	};
	const [a, b] = await Promise.all([shot(hash), shot()]);
	const px = async (src: string) => {
		const im = new Image();
		im.src = src;
		await im.decode();
		const c = document.createElement("canvas");
		c.width = w;
		c.height = h;
		const g = c.getContext("2d", { willReadFrequently: true })!;
		g.fillStyle = "#fff";
		g.fillRect(0, 0, w, h);
		g.drawImage(im, 0, 0, w, h);
		return g.getImageData(0, 0, w, h).data;
	};
	const [pa, pb] = await Promise.all([px(a), px(b)]);
	return compare(pa, pb, w, h);
}

/**
 * 한 쪽만 고른 판으로 되돌린다. 지금 덱에 없는 쪽(그 뒤에 뺀 쪽)이면 그 판의 자리에 다시 끼운다.
 * 그 쪽이 쓰던 그림이 지금 assets/ 에 없으면 그 판에서 꺼내 둔다 — 되돌린 쪽의 그림이 빈 칸으로 나오지 않게.
 * 고친 덱(deck.json)을 돌려준다. 판으로 남기는 일은 부르는 쪽(store)이 한다.
 */
export async function restoreSlide(dir: string, id: string, deck: Deck, diff: VersionDiff, slideId: string): Promise<Deck> {
	const ref = diff.past.slides.find((s) => s.id === slideId);
	if (!ref) throw new Error("그 판에는 이 쪽이 없다");
	const html = await pastText(id, diff.base.hash, ref.file);
	if (html == null) throw new Error(`${ref.file} 을 그 판에서 읽지 못했다`);
	for (const m of html.matchAll(/\.\.\/assets\/([^"'()\s?#]+)/g)) {
		const rel = `assets/${decodeURIComponent(m[1])}`;
		if (await api.exists(dir, rel)) continue;
		const r = await fetch(deckUrl(id, rel, diff.base.hash)).catch(() => null);
		if (r?.ok) await api.writeBytes(dir, rel, new Uint8Array(await r.arrayBuffer()));
	}
	await api.writeText(dir, ref.file, html);
	if (deck.slides.some((s) => s.id === slideId)) return deck;
	const at = diff.removed.find((s) => s.id === slideId)?.at ?? deck.slides.length;
	const slides = [...deck.slides];
	slides.splice(Math.min(at, slides.length), 0, { ...ref });
	return { ...deck, slides };
}

/** 판 하나를 Claude 가 읽을 자리 — .claudeppt/versions/v<n>/ (deck.json · theme.css · slides/) */
export const versionDir = (n: number) => `.claudeppt/versions/v${n}`;

/**
 * @v<n> 멘션 하나를 Claude 에게 넘길 꼴로 — 그 판의 덱 파일을 펼쳐 두고, 지금과 다른 쪽을 한 줄로 적는다.
 * 그림(assets/)은 펼치지 않는다 — 크고, 되살릴 때는 앱의 「이 쪽만 되돌리기」가 꺼내 온다.
 */
export async function versionContext(dir: string, id: string, deck: Deck, c: Commit): Promise<string> {
	const d = await diffVersion(dir, id, deck, c);
	const root = versionDir(c.n);
	await api.writeText(dir, `${root}/deck.json`, JSON.stringify(d.past, null, 1));
	const theme = await pastText(id, c.hash, d.past.theme || "theme.css");
	if (theme != null) await api.writeText(dir, `${root}/${d.past.theme || "theme.css"}`, theme);
	await Promise.all(d.past.slides.map(async (s) => {
		const t = await pastText(id, c.hash, s.file);
		if (t != null) await api.writeText(dir, `${root}/${s.file}`, t);
	}));
	const no = (sid: string) => deck.slides.findIndex((s) => s.id === sid) + 1;
	const changed = deck.slides.filter((s) => d.slides[s.id] === "changed").map((s) => `slide ${no(s.id)} (${s.file})`);
	const added = deck.slides.filter((s) => d.slides[s.id] === "added").map((s) => `slide ${no(s.id)} (${s.file})`);
	const removed = d.removed.map((s) => `${s.title ? `"${s.title}" ` : ""}(${s.file}, was slide ${s.at + 1})`);
	const diffs = [
		changed.length ? `changed since: ${changed.join(", ")}` : "",
		added.length ? `added since: ${added.join(", ")}` : "",
		removed.length ? `removed since: ${removed.join(", ")}` : "",
		d.theme ? "theme.css differs" : "",
	].filter(Boolean);
	return `- @v${c.n} (${c.date}, "${c.subject}") → ${root}/ — ${diffs.length ? diffs.join("; ") : "same as now"}`;
}
