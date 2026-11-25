// 이 앱의 Claude 시스템 프롬프트. 사용자 전역 설정과 무관하게 이것만 실린다 (src-tauri/src/claude.rs 격리 인자).
// 덱의 템플릿(「설정 › 템플릿」 — 글꼴 · 색 · 모양 · 화풍 · 스타일 지침)과 그림 규칙을 매번 덧붙인다 — 설정을 바꾸면 다음 턴부터 따른다.
// 2026.11.24 : 기본 프롬프트를 갈아 끼우는 칸 · 「추가 지침」 칸을 없앴다. 갈아 끼우면 내보내기 규칙이 빠져 PPTX 가 깨지고, 스타일 규칙은 템플릿 지침이 맡는다.

import type { Deck } from "./deck";
import { describe, type Shape } from "./markup";
import type { Mention } from "./mention";
import { type Settings, type Template, templateOf } from "./settings";

export const BASE_PROMPT = `You are the slide engine of ClaudePPT, a desktop app where a person builds a presentation by talking with you.
The deck is a folder of plain HTML files that the app renders live; every file you save appears on screen within a moment and is later exported to an editable PPTX.
You only have file tools. Work only inside the current folder.

# Project layout
- deck.json — title, slide size and slide ORDER (the "slides" array). It is the only source of truth for which slides exist and their order.
- theme.css — shared styles for every slide: CSS variables (--ink, --paper, --accent, --muted, --line, --soft, --radius, --stroke, --font) and the .slide frame. Put repeated styles here as small classes.
- slides/<id>.html — one slide per file: a full HTML document that links "../theme.css" and contains exactly one <section class="slide"> of the deck size (default 1280×720 px).
- assets/ — images and fonts. Reference them from slides as "../assets/<name>".
- source/ — the original PPTX when the deck was imported, and source/pages/<n>.png: pictures of the original slides rendered by PowerPoint. When they exist, Read them and match the HTML to them as closely as possible.
- Never edit .git, .claudeppt or releases. You may Read files under .claudeppt that a request points to (attachments, earlier versions).

# Editing slides
- To add a slide: create slides/<id>.html with a new id ("s" + 6 lowercase letters/digits) and insert {"id","file","title"} into deck.json "slides" at the right position.
- To remove a slide: remove its entry from deck.json (leave the file). To reorder: reorder the array.
- Keep each "title" in deck.json short; the app shows it in the slide rail.
- Prefer Edit for small changes; Write a whole file only for new slides or rewrites. Edit several slides in one turn when the request spans them.
- Offline only: no external URLs, CDNs, web fonts or scripts. No <script> at all.

# Design so the PPTX export stays faithful and editable
The exporter measures the rendered DOM and rebuilds it in PowerPoint:
- Boxes (an element with a background color and/or a full border, optional border-radius) become editable PowerPoint shapes. Draw panels, chips, bars, dividers and simple diagrams this way.
- Text becomes text boxes: put text in block elements whose children are only inline (span, b, strong, em, br). Do not mix bare text with block children.
- <table> becomes a native PowerPoint table — use it for tabular data.
- <img> and inline <svg> become pictures. Use SVG for illustrations, icons, charts and complex shapes.
- Anything PowerPoint cannot draw natively is baked into a picture that looks identical but is no longer editable: gradients, background images, box-shadow, ::before/::after, uneven corners or borders, list markers, and — together with all their children — transforms/rotation, filters, blend modes, clip-path, text-shadow. Prefer flat colors, solid borders and explicit bullet spans so text stays editable.
- PowerPoint only has fonts installed on this PC. Use the theme font (var(--font)); do not introduce other web fonts.
- Lay out with flex/grid or absolute positioning inside .slide; nothing may overflow 1280×720 or scroll.

# Writing on slides
- One message per slide. Short, concrete phrases. No filler, no decorative emoji.
- Hierarchy through size and weight, not boxes around everything. Keep generous margins (≥ 64px).

# Requests with pins
A request may carry pins: comments the person placed on a slide, each with the slide id, a point (x, y in slide pixels) and the element found at that point. A pin can also be a drawn mark — a freehand stroke, an arrow or a box — that shows the area or direction meant. Address every pin; the point or mark tells you where on the slide the comment applies.

# Sketches
A request may attach a sketch picture (.claudeppt/attach/sketch-*.png): a rough drawing in blue ink, either over a faded picture of the slide or on blank paper. Read it before editing. Boxes are regions (cards, images, panels), lines are dividers or lines of text, and handwritten words are the intended content or labels. Follow the arrangement, order and rough proportions; ignore wobbly lines and keep the deck's own style and type. If the drawing is ambiguous, make the most plausible reading and say in one line how you read it.

# Replies
Keep the reply to 1–3 short lines: what you changed, and a question only if something is truly ambiguous. The app already shows which files changed.`;

/** 덱이 쓰는 템플릿 — 가져온 PPTX 는 원본 모양을 따르므로 없다(null). template 이 없는 새 덱(옛 덱)은 기본 템플릿 */
export function deckTemplate(s: Settings, deck: Deck): Template | null {
	if (deck.source?.kind === "pptx" && !deck.template) return null;
	return templateOf(s, deck.template);
}

/** 덱의 스타일 규칙 — 템플릿 규칙, 가져온 PPTX 면 원본을 지키라는 말. 앱 안 Claude 의 시스템 프롬프트와 바깥 CLI 의 style 이 같은 글이다 */
export function houseStyle(s: Settings, deck: Deck) {
	const tpl = deckTemplate(s, deck);
	return tpl ? templateRules(tpl) : "# House style\nThis deck was imported from a PPTX. Keep its own fonts, colors and layout (theme.css and the existing slides); do not restyle it.";
}

/** 템플릿 하나의 스타일 규칙 — 앱 안 Claude 의 시스템 프롬프트와, 바깥 CLI 의 new 가 돌려주는 style 이 같은 글이다 */
export function templateRules(sh: Template) {
	return `# House style (template "${sh.name}")
- Font: ${sh.font} (via var(--font)). Ink ${sh.ink}, paper ${sh.paper}, accent ${sh.accent} — use the CSS variables, not raw hex values.
- Shape corner radius: ${sh.radius}px (var(--radius)). Line weight: ${sh.stroke}px (var(--stroke)).
- Shadows: ${sh.shadow === "none" ? "none — separate with space, tone and alignment" : "only a very soft shadow where depth explains something (note: shadows are dropped in PPTX)"}.
- Icons: ${sh.icon === "line" ? "outline style, stroke = var(--stroke), round caps" : "solid filled style"}, drawn as inline SVG using currentColor.
- Accent color only for the one thing that matters on a slide.${sh.guide.trim() ? `\n\n## Style rules of this template — follow them on every slide\n${sh.guide.trim()}` : ""}`;
}

/** 그림 규칙. outside 는 바깥 CLI 의 style 이 쓴다 — 바깥 세션은 턴이 없어서 그림 자리를 gen 명령으로 채운다 */
export function imageRules(s: Settings, tpl: Template | null, outside = false) {
	const im = s.image;
	if (im.provider === "svg") {
		return `# Images
Draw every illustration, icon, diagram and chart yourself as inline SVG. There is no raster image generator.`;
	}
	return `# Images
Use inline SVG for icons, diagrams and charts. For a photograph or rich illustration, place a placeholder and ${outside ? "then run `cppt gen --deck <dir>` to have the app generate it" : "the app generates it after your turn"}:
<img data-gen="<detailed English description of the image>" data-gen-size="<width>x<height>" style="position:absolute; left:…; top:…; width:…; height:…; object-fit:cover">
- Leave src empty; the app writes the file to assets/ and fills src. To regenerate, change data-gen and remove src.
- Size the element exactly as it should appear.${tpl?.imageStyle ? `\n- Visual style for every generated image: ${tpl.imageStyle}` : ""}`;
}

export function systemPrompt(s: Settings, deck: Deck) {
	const tpl = deckTemplate(s, deck);
	const lang = s.lang === "ko" ? "Korean" : "English";
	return [
		BASE_PROMPT,
		houseStyle(s, deck),
		imageRules(s, tpl),
		// 바뀌지 않는 것만 — 시스템 프롬프트가 바뀌면 이어 온 대화 전체의 프롬프트 캐시가 깨진다. 제목 · 쪽 수 · 쪽 목록은 요청문에 (turnPrompt)
		`# Deck\nSize: ${deck.size.w}×${deck.size.h}px. The current title and slide list come with each request.${deck.source?.kind === "pptx" ? `\nImported from PPTX. Reference pages: ${deck.source.pages ? `source/pages/1.png … ${deck.source.pages}.png` : "none"}` : ""}`,
		`# Language\nWrite replies in ${lang}. Write slide text in the language the person uses for the deck content.`,
	]
		.filter(Boolean)
		.join("\n\n");
}

/** by — 의견을 남긴 팀원 (협업). 보낸 사람과 다르면 Claude 에게 누구의 의견인지 알린다 */
export interface PinNote { n: number; slide: string; slideNo: number; x: number; y: number; text: string; target?: { tag: string; text: string; path: number[] | null }; shape?: Shape; by?: string }

/** 핀 하나를 Claude 가 읽을 글로 — 앱 안 턴의 요청문과 바깥 CLI 의 pins 가 같은 글이다 */
export const pinLine = (p: PinNote) =>
	`${p.n}. slide ${p.slideNo} (slides/${p.slide}.html) ` + (p.shape ? describe(p.shape) : `at (${Math.round(p.x)}, ${Math.round(p.y)})`) + (p.target ? ` on <${p.target.tag}>${p.target.text ? ` "${p.target.text}"` : ""}` : "") + (p.by ? ` (comment by ${p.by})` : "") + `\n   ${p.text.trim() || (p.shape ? "(no comment — look at what this mark shows)" : "(no comment — look at this spot)")}`;

/** 덱의 지금 모습 — 제목과 쪽 목록(번호 · 파일 · 제목). 쪽을 더하고 빼도 시스템 프롬프트가 바뀌지 않게 요청마다 싣는다.
 *  목록이 있으면 Claude 가 deck.json 을 읽으러 오가는 일도 준다. 아주 긴 덱은 앞 80쪽만 */
export function deckOutline(deck: Deck) {
	const list = deck.slides.slice(0, 80).map((s, i) => `${i + 1}. ${s.file}${s.title ? ` "${s.title.replace(/\s+/g, " ").slice(0, 60)}"` : ""}`);
	const more = deck.slides.length > 80 ? `\n… ${deck.slides.length - 80} more in deck.json` : "";
	return `Deck now: "${deck.title}", ${deck.slides.length} slides (deck.json order):\n${list.join("\n")}${more}`;
}

/** 한 턴의 요청문 — 사용자 글 · @쪽 멘션 · @판 멘션 · 핀 · 지금 보던 쪽 · 덱 목차. versions 는 versions.ts versionContext 가 만든 줄 */
export function turnPrompt(text: string, pins: PinNote[], current: { id: string; no: number } | null, attachments: string[], mentions: Mention[] = [], versions: string[] = [], deck?: Deck) {
	const parts: string[] = [];
	if (text.trim()) parts.push(text.trim());
	if (mentions.length) {
		parts.push(
			"Slides mentioned with @ (@N = slide N in deck.json order, @N-M = slides N to M). Apply the request to these slides and leave the others unchanged unless the request says otherwise:\n" +
				mentions.map((m) => `- @${m.no}: ${m.file}${m.title ? ` "${m.title}"` : ""}`).join("\n"),
		);
	}
	if (pins.length) {
		// 표시(펜 · 화살표 · 상자)는 좌표만으로는 뜻이 흐려서, 표시를 그려 넣은 쪽 그림을 첨부로 함께 준다 (markup.ts markedPictures)
		parts.push(
			"Pins (numbered marks the person placed on slides; coordinates are slide pixels" + (pins.some((p) => p.shape) ? ". The attached marks-*.png pictures show each slide with the marks drawn in red and numbered — Read them first" : "") + "):\n" +
				pins.map(pinLine).join("\n"),
		);
	}
	if (versions.length) {
		parts.push(
			"Earlier versions mentioned with @vN, for reference. Each is copied under .claudeppt/versions/vN/ with the same layout (deck.json, theme.css, slides/); slide file names are stable across versions. Read the files the request needs — e.g. to bring back a layout, text or slide from that version — and apply the change to the current files. Never edit the copies:\n" +
				versions.join("\n"),
		);
	}
	if (attachments.length) parts.push("Attached files (Read them):\n" + attachments.map((a) => "- " + a).join("\n"));
	if (current) parts.push(`(The person is looking at slide ${current.no}: slides/${current.id}.html)`);
	if (deck) parts.push(deckOutline(deck));
	return parts.join("\n\n");
}
