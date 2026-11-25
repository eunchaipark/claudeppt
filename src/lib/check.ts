// 웹 ↔ PPT 비교 검사 — 내보낸 PPTX 를 PowerPoint 가 그린 쪽 그림과, 웹이 그린 슬라이드를 1:1 픽셀로 견준다.
// 내보내기 · 릴리즈 뒤에 저절로 돈다 (store.ts verifyPptx) · 바깥 CLI 의 check 도 같은 함수다.
//
//   1. 지금 덱을 PPTX 로 만든다 — 방금 내보낸 것이 있으면 그것을 쓴다 (.claudeppt/check/check.pptx)
//   2. PowerPoint 로 쪽마다 덱 크기 그대로 그린다 (.claudeppt/check/ppt/<n>.png)
//   3. 웹 슬라이드를 런타임이 1:1 로 굽는다 (.claudeppt/check/web/<id>.png)
//   4. 픽셀마다 견주어 다른 곳을 빨갛게 칠한 그림과 차이 비율을 남긴다 (.claudeppt/check/diff/<id>.png · report.json)
//   5. 1 에서 자식까지 통째로 그림이 된 요소(locked)와 그 넓이(stiff)를 함께 남긴다 — 모양은 같아도 편집하지 못하는 곳
//
// 글자 가장자리의 흐림(안티에일리어싱)과 1px 어긋남은 차이로 세지 않는다 — 주변 3×3 안에 같은 색이 있으면 같다고 본다.
// 그래도 남는 1px 너비의 선(글자 획 가장자리 — 두 엔진의 힌팅 차이)도 뺀다: 이웃 8칸 중 4칸 넘게 다른 점만 센다.
// 그래야 남는 차이가 사람 눈에 보이는 차이(빠진 도형 · 다른 색 · 2px 넘게 어긋난 글자)다.
// 2026.11.17 : Pretendard 덱에서 위치 · 크기 · 줄바꿈이 다 맞은 뒤에도 획 가장자리만으로 0.2~0.3% 가 남아 이 거름을 더했다.
import { api, deckUrl, join } from "./api";
import { compare } from "./pixdiff";
import type { Deck } from "./deck";
import { type Built, buildPptx, type Locked } from "./exportPptx";
import { ask, offscreen } from "./frames";

// 2026.11.24 : 그림으로 굳은 것(locked · stiff)을 함께 남긴다. 그림은 PowerPoint 에서도 웹과 똑같이 보여 차이 0% 로 통과하므로,
// 픽셀 차이만으로는 「편집 가능한 PPTX」인지 알 수 없었다. 이 둘이 없는 옛 report.json 은 굳은 것이 없는 것으로 읽는다.
export interface SlideCheck {
	id: string; no: number; score: number; web: string; ppt: string; diff: string;
	/** 자식까지 통째로 그림이 된 요소 — 그 안의 글 · 도형은 PowerPoint 에서 고치지 못한다 */
	locked?: Locked[];
	/** 그 요소들이 덮는 넓이 / 쪽 넓이 (%) — 겹친 곳은 한 번만 센다 */
	stiff?: number;
}
export interface Report { at: string; version: number; slides: SlideCheck[]; missingFonts: string[] }

const BASE = ".claudeppt/check";

async function load(src: string) {
	const im = new Image();
	im.crossOrigin = "anonymous";
	im.src = src;
	await im.decode();
	return im;
}

function pixels(im: HTMLImageElement, w: number, h: number) {
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	const g = c.getContext("2d", { willReadFrequently: true })!;
	g.fillStyle = "#fff";
	g.fillRect(0, 0, w, h);
	g.drawImage(im, 0, 0, w, h);
	return g.getImageData(0, 0, w, h).data;
}

export { compare } from "./pixdiff";

/** 상자들이 덮는 넓이(%) — 8px 칸으로 세어 겹친 곳을 한 번만 센다. 쪽 밖으로 나간 부분은 뺀다 */
function coverage(boxes: Locked[], w: number, h: number) {
	if (!boxes.length) return 0;
	const C = 8, cw = Math.ceil(w / C), ch = Math.ceil(h / C);
	const cell = new Uint8Array(cw * ch);
	for (const b of boxes) {
		const x0 = Math.max(0, Math.floor(b.x / C)), x1 = Math.min(cw, Math.ceil((b.x + b.w) / C));
		const y0 = Math.max(0, Math.floor(b.y / C)), y1 = Math.min(ch, Math.ceil((b.y + b.h) / C));
		for (let y = y0; y < y1; y++) cell.fill(1, y * cw + x0, y * cw + Math.max(x0, x1));
	}
	let n = 0;
	for (const v of cell) n += v;
	return Math.round((n / cell.length) * 1000) / 10;
}

/** given 은 방금 내보낸 PPTX — 같은 것을 견줘야 하고, 다시 만들면 몇십 초가 더 든다. 내보낸 파일은 사용자가 바로 열 수 있어 그 자리를 쓰지 않고 사본을 그린다 */
export async function runCheck(dir: string, id: string, deck: Deck, version: number, step: (msg: string) => void, given?: Built): Promise<Report> {
	const { w, h } = deck.size;
	step("PPTX");
	const built = given ?? (await buildPptx(deck, id, (i, n) => step(`PPTX ${i}/${n}`)));
	await api.writeBytes(dir, `${BASE}/check.pptx`, built.data);
	step("PowerPoint");
	const pages = await api.pptSnapshot(join(dir, ".claudeppt", "check", "check.pptx"), join(dir, ".claudeppt", "check", "ppt"), w, h);
	if (!pages) throw new Error("PowerPoint 로 쪽 그림을 뽑지 못했다");
	const slides: SlideCheck[] = [];
	const stamp = Date.now();
	for (let i = 0; i < deck.slides.length; i++) {
		const ref = deck.slides[i];
		step(`${i + 1}/${deck.slides.length}`);
		const { win, dispose } = await offscreen(id, ref.file, w, h);
		let snap: any;
		try { snap = await ask(win, { t: "snapshot", scale: 1 }, 60000); } finally { dispose(); }
		if (snap.error) throw new Error(`${i + 1}쪽: ${snap.error}`);
		const web = `${BASE}/web/${ref.id}.png`, ppt = `${BASE}/ppt/${i + 1}.png`, diff = `${BASE}/diff/${ref.id}.png`;
		await api.writeB64(dir, web, snap.data.split(",")[1]);
		const [wi, pi] = await Promise.all([load(snap.data), load(deckUrl(id, ppt) + "?t=" + stamp)]);
		const r = compare(pixels(wi, w, h), pixels(pi, w, h), w, h);
		await api.writeB64(dir, diff, r.mask.split(",")[1]);
		const locked = built.locked[i] || [];
		slides.push({ id: ref.id, no: i + 1, score: r.score, web, ppt, diff, locked, stiff: coverage(locked, w, h) });
	}
	const report: Report = { at: new Date().toISOString(), version, slides, missingFonts: built.missingFonts };
	await api.writeText(dir, `${BASE}/report.json`, JSON.stringify(report, null, 1));
	return report;
}

/** 차이가 이보다 작으면 같다고 본다(%) — 글자 가장자리 몇 점 */
export const SAME = 0.05;

/** 고칠 거리가 있는 쪽 — 모양이 다르거나, 같아도 편집할 수 없는 그림으로 굳은 것이 있다 */
export const needsFix = (x: SlideCheck) => x.score > SAME || !!x.locked?.length;
