// 웹 슬라이드 → PPTX. 쪽마다 화면 밖 iframe 에 1:1 로 그려 런타임(rt.js extract)이 잰 좌표로 PowerPoint 도형을 만든다.
// 상자 → 도형 · 글자 묶음 → 글상자 · 표 → 표 · 그림/SVG → 그림. 96px = 1in.
// 한 요소(카드 · 행 · 목록 칸)에서 나온 도형은 다 만든 뒤 PowerPoint 그룹으로 묶는다 (groupSlides).
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import type { Deck } from "./deck";
import { installedNames } from "./fonts";
import { ask, offscreen } from "./frames";

const IN = (px: number) => px / 96;
const PT = (px: number) => Math.round(px * 0.75 * 10) / 10;

// PowerPoint 는 「정확히」 줄 간격에서 첫 줄 기준선을 글상자 위에서 약 0.716 × 줄 높이 + 0.089 × 글자 크기 아래에 둔다.
// 브라우저는 글꼴의 위 · 아래 높이로 정한다 — 그 차이만큼 글상자를 옮겨야 글자가 같은 높이에 선다.
// 2026.11.17 : Pretendard 로 크기 12~56px × 줄 높이 1.0~1.8 의 28칸을 내보내 PowerPoint 쪽 그림과 견주어 맞췄다 (남은 어긋남 1px 안 — 줄 높이 1.0 은 글자가 상자 위로 넘쳐 재지 못했다).
const PPT_BASE_LH = 0.716;
const PPT_BASE_SZ = 0.089;
/** 위 두 항을 넣은 뒤에도 남던 한결같은 1px 위로 뜸 */
const PPT_BASE_PX = -0.9;

const dashOf = (d?: string | null) => (d === "dashed" ? "dash" : d === "dotted" ? "sysDot" : "solid") as "dash" | "sysDot" | "solid";

// 굵기 → 글꼴 이름. PowerPoint 는 한 가족 안에서 보통 · 굵게 둘만 고른다 — 500 · 600 같은 굵기는
// 「Pretendard Medium」 · 「Pretendard SemiBold」 처럼 따로 깔린 이름으로 골라야 웹과 같은 굵기가 된다.
const WEIGHT_NAMES: Record<number, string[]> = {
	100: ["Thin", "Hairline"], 200: ["ExtraLight", "UltraLight"], 300: ["Light"], 400: ["Regular"],
	500: ["Medium"], 600: ["SemiBold", "DemiBold"], 700: ["Bold"], 800: ["ExtraBold", "UltraBold"], 900: ["Black", "Heavy"],
};
const GENERIC = new Set(["sans-serif", "serif", "monospace", "system-ui", "cursive", "fantasy", ""]);

interface FontCtx { have: Set<string>; missing: Set<string> }
function faceOf(list: string, weight: number, f: FontCtx): { face: string | undefined; bold: boolean } {
	const w = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
	const has = (n: string) => f.have.has(n.toLowerCase());
	const families = list.split("|").filter(Boolean);
	// 브라우저처럼 목록에서 이 PC 에 깔린 첫 글꼴을 고른다. 하나도 없으면 첫 글꼴을 쓰고 「없는 글꼴」로 알린다
	const family = families.find((x) => !GENERIC.has(x) && (has(x) || WEIGHT_NAMES[w].some((n) => has(`${x} ${n}`))));
	if (!family) {
		const first = families.find((x) => !GENERIC.has(x));
		if (!first) return { face: undefined, bold: weight >= 600 };
		f.missing.add(first);
		return { face: first, bold: w >= 600 };
	}
	if (w !== 400 && w !== 700) for (const n of WEIGHT_NAMES[w]) if (has(`${family} ${n}`)) return { face: `${family} ${n}`, bold: false };
	return { face: family, bold: w >= 600 };
}

/** 런타임이 잰 글자 조각 → pptxgenjs 글 조각. <br> 은 앞 조각의 줄바꿈이 된다 */
function toRuns(runs: any[], f: FontCtx) {
	return runs
		.map((r: any, j: number) => {
			if (r.br) return null;
			const next = runs[j + 1];
			const fc = faceOf(r.font || "", r.weight ?? (r.bold ? 700 : 400), f);
			return {
				text: r.text,
				options: {
					fontSize: PT(r.size), bold: fc.bold, italic: r.italic, color: r.color, fontFace: fc.face,
					charSpacing: r.spacing ? PT(r.spacing) : undefined,
					highlight: r.highlight || undefined,
					underline: r.underline ? { style: "sng" } : undefined, strike: r.strike ? "sngStrike" : undefined,
					transparency: r.alpha != null && r.alpha < 1 ? Math.round((1 - r.alpha) * 100) : undefined,
					breakLine: !!next?.br,
					// 브라우저가 줄을 바꾼 자리 — 같은 문단 안 줄 바꿈
					softBreakBefore: !!r.soft && j > 0 && !runs[j - 1]?.br,
				},
			};
		})
		.filter(Boolean) as any[];
}

/** 편집할 수 없는 그림으로 굳은 요소 하나 — 슬라이드 좌표(px) */
export interface Locked { x: number; y: number; w: number; h: number; tag: string }

/** 원래 그림인 요소 — 통째로 구워도 잃는 것이 없다 */
const PICTURE_TAGS = new Set(["img", "svg", "canvas", "video", "picture"]);

/**
 * data 는 날바이트 — base64 로 싸면 큰 덱에서 메모리가 몇 벌로 불어난다 (가져오기와 같은 까닭).
 * locked 는 쪽마다 자식까지 통째로 그림이 된 요소(변형 · 필터 · 글자 그림자 · 목록 글머리 …).
 * 비교 검사가 이것을 따로 센다 — 그림이 되면 PowerPoint 그림과 웹이 똑같아 차이 0% 로 통과하지만, 글자 · 도형은 더 고치지 못한다.
 */
export interface Built { data: Uint8Array; missingFonts: string[]; locked: Locked[][] }

/**
 * exact=true 면 쪽마다 웹을 2배로 구운 그림 한 장을 깔고, 그 위에 같은 자리의 글상자를 투명하게 얹는다.
 * 글자 획 가장자리까지 웹과 같다 — 대신 PowerPoint 에서 모양을 고치지 못한다(글은 찾기 · 복사만).
 */
export async function buildPptx(deck: Deck, projectId: string, progress: (i: number, n: number) => void, exact = false): Promise<Built> {
	// 깔린 글꼴은 가족 이름 · 전체 이름을 나라말마다 본다 — 한글 이름(「에스코어 드림 5 Medium」)도 깔린 것으로 알아본다
	const fonts: FontCtx = { have: await installedNames(), missing: new Set() };
	const pptx = new PptxGenJS();
	pptx.defineLayout({ name: "DECK", width: IN(deck.size.w), height: IN(deck.size.h) });
	pptx.layout = "DECK";
	pptx.title = deck.title;
	// 쪽마다 만든 도형의 묶음 사슬 · 묶음 이름 — exact 는 그림 한 장 위 투명 글이라 묶지 않는다(null)
	const plan: ({ chains: number[][]; names: Record<number, string> } | null)[] = [];
	const locked: Locked[][] = [];

	for (let i = 0; i < deck.slides.length; i++) {
		progress(i, deck.slides.length);
		const ref = deck.slides[i];
		// 숨은 iframe 이 가끔 답하지 않는다 (2026.11.17 실측 — 같은 쪽을 다시 띄우면 1초 안에 끝났다). 새로 띄워 두 번까지 묻는다
		let res: any;
		for (let attempt = 0; ; attempt++) {
			const { win, dispose } = await offscreen(projectId, ref.file, deck.size.w, deck.size.h);
			try { res = await ask(win, { t: "extract" }, 20000); break; }
			catch (e) { if (attempt >= 1) throw e; }
			finally { dispose(); }
		}
		if (res.error) throw new Error(`${i + 1}쪽: ${res.error}`);
		const data = res.data;
		locked.push(data.items
			.filter((it: any) => it.type === "image" && it.baked === "whole" && !PICTURE_TAGS.has(it.tag))
			.map((it: any) => ({ x: Math.round(it.x), y: Math.round(it.y), w: Math.round(it.w), h: Math.round(it.h), tag: it.tag })));
		const slide = pptx.addSlide();
		if (exact) {
			const { win, dispose } = await offscreen(projectId, ref.file, deck.size.w, deck.size.h);
			let snap: any;
			try { snap = await ask(win, { t: "snapshot", scale: 2 }, 60000); } finally { dispose(); }
			if (snap.error) throw new Error(`${i + 1}쪽: ${snap.error}`);
			plan.push(null);
			slide.addImage({ data: snap.data.replace(/^data:/, ""), x: 0, y: 0, w: IN(deck.size.w), h: IN(deck.size.h) });
			if (ref.notes) slide.addNotes(ref.notes);
			for (const it of data.items) {
				if (it.type !== "text") continue;
				slide.addText(toRuns(it.runs, fonts).map((r: any) => ({ ...r, options: { ...r.options, transparency: 100 } })) as any, { x: IN(it.x), y: IN(it.y), w: IN(it.w * 1.04), h: IN(Math.max(it.h, 1)), margin: 0, valign: it.valign, fit: "none", wrap: true } as any);
			}
			continue;
		}
		if (data.background) slide.background = { color: data.background.hex };
		if (ref.notes) slide.addNotes(ref.notes);
		const chains: number[][] = [];
		plan.push({ chains, names: data.groups || {} });
		for (const it of data.items) {
			// 아래 다섯 갈래는 도형을 꼭 하나씩 만든다 — 슬라이드 XML 의 도형 순서와 이 사슬 순서가 맞아야 묶을 수 있다
			if (["box", "line", "image", "text", "table"].includes(it.type)) chains.push(it.g || []);
			if (it.type === "box") {
				const isRound = it.round;
				const shape = isRound ? pptx.ShapeType.ellipse : it.radius > 0.5 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
				// 선은 PowerPoint 가 도형 테두리 가운데에 긋는다 — CSS border(안쪽)와 같은 자리가 되게 도형을 선 두께 반만큼 줄인다.
				// 2026.11.24 : 줄이지 않아 테두리 있는 상자가 PPTX 에서 선 두께만큼 커졌다
				const g = it.line ? it.line.w / 2 : 0;
				slide.addShape(shape, {
					x: IN(it.x + g), y: IN(it.y + g), w: IN(Math.max(0, it.w - g * 2)), h: IN(Math.max(0, it.h - g * 2)),
					fill: it.fill ? { color: it.fill.hex, transparency: Math.round((1 - it.fill.alpha) * 100) } : { type: "none" },
					line: it.line ? { color: it.line.hex, width: PT(it.line.w), dashType: dashOf(it.line.dash), transparency: Math.round((1 - it.line.alpha) * 100) } : { type: "none" },
					rectRadius: !isRound && it.radius > 0.5 ? IN(Math.max(0, Math.min(it.radius, Math.min(it.w, it.h) / 2) - g)) : undefined,
					// 바깥 그림자 — 거리 · 방향은 x · y 어긋남에서, 흐림은 CSS blur 그대로 (가져오기가 blurRad 를 그대로 blur 로 썼다)
					shadow: it.shadow ? {
						type: "outer", color: it.shadow.hex, opacity: it.shadow.alpha, blur: PT(it.shadow.blur),
						offset: PT(Math.hypot(it.shadow.x, it.shadow.y)), angle: Math.round(((Math.atan2(it.shadow.y, it.shadow.x) * 180) / Math.PI + 360) % 360),
					} : undefined,
				} as any);
			} else if (it.type === "line") {
				slide.addShape(pptx.ShapeType.line, {
					x: IN(Math.min(it.x1, it.x2)), y: IN(Math.min(it.y1, it.y2)), w: IN(Math.abs(it.x2 - it.x1)), h: IN(Math.abs(it.y2 - it.y1)),
					line: { color: it.color, width: PT(it.w), dashType: dashOf(it.dash) },
				});
			} else if (it.type === "image") {
				slide.addImage({ data: it.data.replace(/^data:/, ""), x: IN(it.x), y: IN(it.y), w: IN(it.w), h: IN(it.h), altText: it.alt || undefined });
			} else if (it.type === "text") {
				// PowerPoint 는 같은 글꼴도 브라우저보다 조금 넓게 그린다 — 줄바꿈이 달라지지 않게 너비를 4% 넓힌다 (정렬 방향 반대쪽으로)
				const extra = it.w * 0.04;
				const x = it.align === "center" ? it.x - extra / 2 : it.align === "right" ? it.x - extra : it.x;
				// 위 맞춤일 때만 옮긴다 — 가운데 · 아래 맞춤은 PowerPoint 가 줄 묶음 전체를 상자 안에서 다시 놓는다
				const shift = it.baseline != null && it.lineHeight && it.valign === "top" ? it.baseline - (PPT_BASE_LH * it.lineHeight + PPT_BASE_SZ * it.size0 + PPT_BASE_PX) : 0;
				const runs = toRuns(it.runs, fonts);
				if (it.bullet && runs[0]) (runs[0] as any).options.bullet = true;
				slide.addText(runs as any, {
					x: IN(x), y: IN(it.y + shift), w: IN(it.w + extra), h: IN(Math.max(it.h, 1)),
					margin: 0, valign: it.valign, align: it.align === "justify" ? "justify" : it.align, fit: "none", wrap: true,
					lineSpacing: it.lineHeight ? PT(it.lineHeight) : undefined,
				} as any);
			} else if (it.type === "table") {
				const rows = it.rows.map((row: any[]) => row.map((c) => ({
					text: c.runs?.length ? toRuns(c.runs, fonts) : c.text,
					options: {
						fontSize: PT(c.size), bold: c.bold, color: c.color, fontFace: faceOf(c.font || "", c.bold ? 700 : 400, fonts).face, valign: c.valign,
						fill: c.fill ? { color: c.fill } : undefined, align: c.align === "center" ? "center" : c.align === "right" ? "right" : "left",
						colspan: c.colspan > 1 ? c.colspan : undefined, rowspan: c.rowspan > 1 ? c.rowspan : undefined,
						border: c.border && c.bw ? [{ type: "solid", pt: PT(c.bw), color: c.border }, { type: "solid", pt: PT(c.bw), color: c.border }, { type: "solid", pt: PT(c.bw), color: c.border }, { type: "solid", pt: PT(c.bw), color: c.border }] : undefined,
						// pptxgenjs 는 윗여백이 1 보다 작으면 네 값을 모두 인치로, 아니면 pt 로 읽는다 — 윗여백이 1pt 아래인 칸(원본 여백 0)에서
						// 나머지 4pt 가 4인치가 되어 표가 무너졌다 (2026.11.18). 그래서 윗여백에 맞춰 단위를 골라 넘긴다
						// 웹 칸 크기에는 테두리 두께 절반이 들어 있고 PowerPoint 칸에는 없다 — 그 절반을 여백에 돌려 줘야 행 높이 · 글 자리가 같다
						margin: c.pad ? ((pad: number[]) => (IN(pad[0]) < 1 ? pad.map(IN) : pad.map(PT)))(c.pad.map((v: number) => v + (c.bw || 0) / 2)) : 3,
					},
				})));
				slide.addTable(rows, { x: IN(it.x), y: IN(it.y), w: IN(it.w), colW: it.colW.map(IN), rowH: it.rowH.map(IN) } as any);
			}
		}
	}
	progress(deck.slides.length, deck.slides.length);
	const raw = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
	// 묶기 · 그림 합치기가 어긋나도 내보내기는 살린다 — 손보지 않은 파일이 손보다 깨진 파일보다 낫다
	const out = await tidyZip(raw, plan).catch((e) => { console.warn("tidy", e); return raw; });
	return { data: out, missingFonts: [...fonts.missing], locked };
}

// ── 그룹 묶기 ──────────────────────────────────────────────────────────
// pptxgenjs 는 그룹을 만들지 못한다. 다 쓴 PPTX 의 슬라이드 XML 에서 도형을 <p:grpSp> 로 감싼다.
// 묶음 기준: 같은 요소에서 나온 도형이 둘 이상이면 그 요소가 그룹이 된다. 단
//   · 쪽 전체를 감싸는 요소는 묶지 않는다 — 모든 도형이 한 그룹이면 하나만 고르기가 늘 두 번 클릭이 된다
//   · 자식 하나만 감싼 겉 요소(같은 도형을 담은 묶음)는 안쪽 하나로 합친다 — 그룹 안에 그룹만 하나 든 껍데기를 만들지 않는다

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

type GNode = { id: number; kids: (GNode | number)[] };

/** 도형마다의 사슬(겉 → 안 요소 번호) → 묶음 나무. 잎은 도형 순번 */
function groupTree(chains: number[][]): (GNode | number)[] {
	const count = new Map<number, number>();
	for (const c of chains) for (const id of c) count.set(id, (count.get(id) || 0) + 1);
	const top: (GNode | number)[] = [];
	chains.forEach((chain, i) => {
		let list = top, prev = chains.length;
		for (const id of chain) {
			const n = count.get(id)!;
			if (n < 2 || n >= prev) continue;
			prev = n;
			// 한 요소의 도형은 줄지어 나오므로 같은 묶음은 늘 목록 끝에 있다
			const last = list[list.length - 1];
			let g = typeof last === "object" && last.id === id ? last : null;
			if (!g) { g = { id, kids: [] }; list.push(g); }
			list = g.kids;
		}
		list.push(i);
	});
	return top;
}

const kid = (el: Element, name: string) => [...el.children].find((c) => c.localName === name);
/** 도형 하나의 자리(EMU) — sp · pic · cxnSp 는 spPr, 표는 xfrm, 그룹은 grpSpPr */
function boundsOf(el: Element) {
	const pr = el.localName === "graphicFrame" ? el : kid(el, el.localName === "grpSp" ? "grpSpPr" : "spPr");
	const xf = pr && kid(pr, "xfrm");
	const off = xf && kid(xf, "off"), ext = xf && kid(xf, "ext");
	if (!off || !ext) return null;
	const x = +off.getAttribute("x")!, y = +off.getAttribute("y")!;
	return { x, y, r: x + +ext.getAttribute("cx")!, b: y + +ext.getAttribute("cy")! };
}

/** 다 쓴 PPTX 손보기 — 도형 묶기 · 같은 그림 합치기. 바꾼 것이 없으면 그대로 돌려준다 */
async function tidyZip(data: Uint8Array, plan: ({ chains: number[][]; names: Record<number, string> } | null)[]): Promise<Uint8Array> {
	const zip = await JSZip.loadAsync(data);
	const grouped = await groupSlides(zip, plan).catch((e) => { console.warn("group", e); return false; });
	const merged = await dedupeMedia(zip);
	if (!grouped && !merged) return data;
	// 그림은 이미 압축된 꼴(PNG · JPEG)이라 다시 DEFLATE 해도 작아지지 않고 시간만 든다 — 그대로(STORE) 담는다
	for (const n of Object.keys(zip.files)) {
		if (n.startsWith("ppt/media/") && !zip.files[n].dir) zip.file(n, await zip.file(n)!.async("uint8array"), { compression: "STORE" });
	}
	return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** 같은 그림은 한 파일로 — pptxgenjs 는 쪽마다(같은 로고 · 같은 사진이어도) 그림 파일을 따로 넣는다.
 *  내용(SHA-1 · 크기)이 같으면 첫 파일만 두고 관계(rels)의 대상을 그리로 돌린다 */
async function dedupeMedia(zip: JSZip): Promise<boolean> {
	const media = Object.keys(zip.files).filter((n) => n.startsWith("ppt/media/") && !zip.files[n].dir);
	if (media.length < 2) return false;
	const first = new Map<string, string>();
	const alias = new Map<string, string>();
	for (const n of media) {
		const bytes = await zip.file(n)!.async("uint8array");
		const h = [...new Uint8Array(await crypto.subtle.digest("SHA-1", bytes as BufferSource))].map((b) => b.toString(16).padStart(2, "0")).join("") + ":" + bytes.length;
		const k = first.get(h);
		if (k) alias.set(n, k);
		else first.set(h, n);
	}
	if (!alias.size) return false;
	for (const n of Object.keys(zip.files).filter((n) => n.endsWith(".rels"))) {
		const x = await zip.file(n)!.async("string");
		// 「"」 까지 맞춘다 — image-1-1 이 image-1-10 의 앞부분과 섞이지 않게
		let y = x;
		for (const [dup, keep] of alias) y = y.split(`media/${dup.slice("ppt/media/".length)}"`).join(`media/${keep.slice("ppt/media/".length)}"`);
		if (y !== x) zip.file(n, y);
	}
	for (const dup of alias.keys()) zip.remove(dup);
	return true;
}

async function groupSlides(zip: JSZip, plan: ({ chains: number[][]; names: Record<number, string> } | null)[]): Promise<boolean> {
	if (!plan.some((p) => p && p.chains.some((c) => c.length))) return false;
	let changed = false;
	for (let i = 0; i < plan.length; i++) {
		const p = plan[i];
		if (!p) continue;
		const tree = groupTree(p.chains);
		if (!tree.some((n) => typeof n === "object")) continue;
		const path = `ppt/slides/slide${i + 1}.xml`;
		const file = zip.file(path);
		if (!file) continue;
		const doc = new DOMParser().parseFromString(await file.async("string"), "application/xml");
		const tbl = doc.getElementsByTagNameNS(NS_P, "spTree")[0];
		if (!tbl || doc.getElementsByTagName("parsererror").length) continue;
		const shapes = [...tbl.children].filter((c) => c.localName !== "nvGrpSpPr" && c.localName !== "grpSpPr");
		// 도형 수가 사슬 수와 다르면 어느 도형이 어느 요소인지 모른다 — 그 쪽은 묶지 않는다
		if (shapes.length !== p.chains.length) { console.warn(`group: ${i + 1}쪽 도형 ${shapes.length} ≠ ${p.chains.length}`); continue; }
		let nextId = Math.max(0, ...[...doc.getElementsByTagNameNS(NS_P, "cNvPr")].map((e) => +e.getAttribute("id")! || 0)) + 1;
		const mk = (name: string, ns = NS_P) => doc.createElementNS(ns, (ns === NS_P ? "p:" : "a:") + name);
		const build = (n: GNode | number): Element => {
			if (typeof n === "number") return shapes[n];
			const kids = n.kids.map(build);
			const bs = kids.map(boundsOf).filter(Boolean) as { x: number; y: number; r: number; b: number }[];
			const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
			const cx = Math.max(...bs.map((b) => b.r)) - x, cy = Math.max(...bs.map((b) => b.b)) - y;
			const g = mk("grpSp");
			const nv = mk("nvGrpSpPr"), c = mk("cNvPr");
			c.setAttribute("id", String(nextId++));
			c.setAttribute("name", p.names[n.id] || `Group ${n.id}`);
			nv.append(c, mk("cNvGrpSpPr"), mk("nvPr"));
			// 자식 좌표계를 바깥과 같게(chOff = off · chExt = ext) — 자식 도형 좌표를 고치지 않아도 제자리다
			const pr = mk("grpSpPr"), xf = mk("xfrm", NS_A);
			const pt = (name: string, a: string, b: string, va: number, vb: number) => { const e = mk(name, NS_A); e.setAttribute(a, String(va)); e.setAttribute(b, String(vb)); return e; };
			xf.append(pt("off", "x", "y", x, y), pt("ext", "cx", "cy", cx, cy), pt("chOff", "x", "y", x, y), pt("chExt", "cx", "cy", cx, cy));
			pr.append(xf);
			g.append(nv, pr, ...kids);
			return g;
		};
		// 겹침 순서를 지키려고 묶음은 그 첫 도형 자리에 넣는다 — 도형은 줄지어 있으므로 사이에 다른 도형이 끼지 않는다
		// extLst 는 spTree 맨 끝이어야 한다 — 그 앞에 넣는다
		const tail = kid(tbl, "extLst") || null;
		for (const n of tree) tbl.insertBefore(build(n), tail);
		// 도형 번호를 처음부터 다시 매긴다 — pptxgenjs 는 표(graphicFrame) 번호를 도형 번호와 겹쳐 쓴다 (2026.11.23 실측 · 58쪽 중 7쪽)
		[...doc.getElementsByTagNameNS(NS_P, "cNvPr")].forEach((e, k) => e.setAttribute("id", String(k + 1)));
		zip.file(path, new XMLSerializer().serializeToString(doc));
		changed = true;
	}
	return changed;
}
