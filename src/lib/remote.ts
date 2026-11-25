// 바깥 제어 — 앱 밖 Claude Code 가 CLI 로 보낸 명령을 받아 처리한다 (src-tauri/src/control.rs · cli.rs).
//
//   status · refresh         열린 덱 · 앱 안 Claude 가 일하는 중인지 / CLI 가 판을 남긴 뒤 판 목록 다시 읽기
//   open                     덱을 화면에 연다 · 그 쪽으로 간다
//   new · import             저장 폴더에 새 덱 — 앱의 처음 화면 · 가져오기와 같은 길(createDeck · flows.importDeck)
//   export · shot · inspect  웹뷰가 쪽을 그려야 하는 일 — 내보내기와 같은 런타임(rt.js)의 extract · snapshot 을 쓴다
//   check · release          비교 검사 · 릴리즈 — 앱의 단추와 같은 함수(runCheck · makeRelease)
//   style                    덱이 따를 스타일 · 그림 규칙 — 앱 안 Claude 의 시스템 프롬프트와 같은 글(prompt.ts houseStyle · imageRules)
//   pins · unpin             사용자가 꽂은 핀을 앱 안 턴과 같은 글(pinLine) · 같은 표시 그림(markedPictures)으로 / 다 고친 핀 지우기
//   gen                      그림 자리(data-gen) 채우기 — 앱 안 턴 끝과 같은 함수(fillGenerated)
//   touch                    CLI 가 덱을 다룰 때마다 알린다 → store.outside. 그 덱에서 보내기 전에 한 번 묻는다
//
// 열려 있지 않은 덱도 화면을 바꾸지 않고 처리한다 — deck:// 에 잠깐 올렸다가(api.open) 감시만 내린다.
// 오래 걸리는 일은 오른쪽 아래 진행 막대(jobs)에 「CLI · …」 로 보인다 — 사용자가 밖에서 무엇을 시켰는지 알게.
// 앱 안 Claude 가 일하는 중이면 화면의 덱을 바꾸지 않는다 — 덱을 닫으면 그 턴이 멈춘다 (store.closeProject).
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { api, bytesFromB64, join } from "./api";
import { createDeck, type Deck, readDeck } from "./deck";
import { freeDir, importDeck } from "./flows";
import { linkFonts } from "./fonts";
import { ask, offscreen } from "./frames";
import { tNow } from "./i18n";
import { fillGenerated } from "./imagegen";
import { describe, markedPictures } from "./markup";
import { deckTemplate, houseStyle, imageRules, type PinNote, pinLine, templateRules } from "./prompt";
import { templateOf, useSettings } from "./settings";
import { makeRelease, OUTSIDE_MS, type Pin, type Release, useDeck } from "./store";

type Args = Record<string, any>;

const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
const same = (a: string, b: string) => !!a && !!b && norm(a) === norm(b);

/** 덱을 deck:// 에 올려 둔 채 fn 을 돌린다. 화면에 열린 덱이면 그 id 를 그대로 쓴다 */
async function withDeck<T>(dir: string, fn: (id: string, deck: Deck) => Promise<T>): Promise<T> {
	const deck = await readDeck(dir);
	const st = useDeck.getState();
	if (same(st.dir, dir)) return fn(st.id, deck);
	// 열린 덱은 openProject 가 글꼴을 이었다. 열지 않은 덱도 그리기 전에 잇는다 — 안 그러면 쪽 그림 · 내보내기가 대체 글꼴로 나온다
	await linkFonts(dir, deck).catch(() => {});
	const id = await api.open(dir);
	try {
		return await fn(id, deck);
	} finally {
		// 그새 사용자가 이 덱을 열었으면 감시를 내리지 않는다
		if (!same(useDeck.getState().dir, dir)) await api.close(id).catch(() => {});
	}
}

/** 진행 막대 하나를 띄우고 일을 돌린다 */
async function job<T>(label: string, fn: (step: (i: number, n: number) => void) => Promise<T>): Promise<T> {
	const id = "cli" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
	const step = (i: number, n: number) => useDeck.setState((s) => ({
		jobs: s.jobs.some((j) => j.id === id) ? s.jobs.map((j) => (j.id === id ? { ...j, i, n } : j)) : [...s.jobs, { id, label: `CLI · ${label}`, i, n }],
	}));
	step(0, 0);
	try { return await fn(step); } finally { useDeck.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })); }
}

/** 쪽 번호(1부터) 목록 → 쪽. null 이면 모든 쪽 */
function pick(deck: Deck, nums: number[] | null) {
	const all = deck.slides.map((ref, i) => ({ no: i + 1, ref }));
	if (!nums) return all;
	const bad = nums.filter((n) => n < 1 || n > all.length);
	if (bad.length) throw new Error(`없는 쪽: ${bad.join(", ")} (이 덱은 ${all.length}쪽)`);
	return nums.map((n) => all[n - 1]);
}

const titleOf = (dir: string, d: Deck) => d.title || dir.split(/[\\/]/).pop();

/** 덱의 핀 — 화면에 열린 덱이면 앱이 쥔 것(파일보다 앞설 수 있다), 아니면 .claudeppt/pins.json */
async function pinsOf(dir: string): Promise<Pin[]> {
	const st = useDeck.getState();
	if (same(st.dir, dir)) return st.pins;
	try { return JSON.parse(await api.readText(dir, ".claudeppt/pins.json")); } catch { return []; }
}

function status() {
	const st = useDeck.getState();
	return {
		app: true,
		dir: st.dir || null,
		title: st.deck?.title ?? null,
		slides: st.deck?.slides.length ?? null,
		slide: st.deck ? st.current + 1 : null,
		version: st.versions[0]?.n ?? null,
		running: !!st.running,
		busy: st.busy,
		jobs: st.jobs.map((j) => j.label),
	};
}

/** 화면의 덱을 바꾼다. 앱 안 Claude 가 다른 덱을 고치는 중이면 바꾸지 않는다 */
async function show(dir: string, slide?: number | null) {
	const st = useDeck.getState();
	if (!same(st.dir, dir)) {
		if (st.running) throw new Error("앱 안 Claude 가 다른 덱을 고치는 중이라 화면을 바꾸지 않았다");
		await st.openProject(dir);
	}
	if (slide) useDeck.getState().setCurrent(slide - 1);
}

const handlers: Record<string, (a: Args) => Promise<unknown>> = {
	status: async () => status(),

	touch: async ({ dir, cmd }) => {
		const st = useDeck.getState();
		const prev = st.outside;
		const fresh = !prev || !same(prev.dir, dir) || Date.now() - prev.at >= OUTSIDE_MS;
		useDeck.setState({ outside: { dir, at: Date.now(), cmd: String(cmd || "") } });
		// 처음 한 번만 알린다 — 명령마다 띄우면 알림이 쌓여 화면을 가린다
		if (fresh && same(st.dir, dir)) st.notify(tNow("outsideNotice"));
		return null;
	},

	style: async ({ dir }) => {
		const s = useSettings.getState().s;
		const deck = await readDeck(dir);
		const tpl = deckTemplate(s, deck);
		return { template: tpl?.name ?? null, imported: !tpl, images: s.image.provider, style: houseStyle(s, deck) + "\n\n" + imageRules(s, tpl, true) };
	},

	pins: async ({ dir, slides, marks }) => {
		const deck = await readDeck(dir);
		const order = (id: string) => deck.slides.findIndex((x) => x.id === id) + 1;
		// 번호는 앱 안 턴과 같다 — 꽂은 차례. --slides 로 걸러도 번호는 그대로라 pins --done 에 그대로 쓴다.
		// 해결된 의견(협업)은 빼고, 팀원이 남긴 의견이면 누구의 것인지 함께 준다
		const all: PinNote[] = (await pinsOf(dir)).filter((p) => !p.done).map((p, i) => ({ n: i + 1, slide: p.slide, slideNo: order(p.slide), x: p.x, y: p.y, text: p.text, target: p.target, shape: p.shape, by: p.by }));
		const want = Array.isArray(slides) ? all.filter((p) => slides.includes(p.slideNo)) : all;
		// 표시 그림 — 좌표 글만으로는 「어디를 가리키는지」를 자주 잘못 짚는다. 앱 안 턴과 같은 그림을 .claudeppt/attach 에 굽는다
		const pictures = marks && want.length ? await withDeck(dir, (id, d) => markedPictures(dir, id, d, want)) : [];
		return {
			count: all.length,
			pins: want.map((p) => ({
				n: p.n,
				slide: p.slideNo || null,
				file: `slides/${p.slide}.html`,
				x: Math.round(p.x),
				y: Math.round(p.y),
				text: p.text,
				target: p.target ? { tag: p.target.tag, text: p.target.text } : null,
				mark: p.shape ? describe(p.shape) : null,
				by: p.by ?? null,
			})),
			text: want.map(pinLine).join("\n"),
			marks: pictures.map((rel) => join(dir, rel)),
		};
	},

	unpin: async ({ dir, nums }) => {
		const every = await pinsOf(dir);
		// 번호는 pins 와 같이 열린 의견 차례
		const all = every.filter((p) => !p.done);
		const bad = Array.isArray(nums) ? nums.filter((n: number) => n < 1 || n > all.length) : [];
		if (bad.length) throw new Error(`없는 핀: ${bad.join(", ")} (핀 ${all.length}개)`);
		const drop = Array.isArray(nums) ? all.filter((_, i) => nums.includes(i + 1)) : all;
		const st = useDeck.getState();
		// 화면에 열린 덱은 앱이 핀을 쥐고 있다 — 파일만 고치면 다음 핀 변경 때 앱이 옛 목록으로 덮어쓴다
		if (same(st.dir, dir)) for (const p of drop) useDeck.getState().removePin(p.id);
		else await api.writeText(dir, ".claudeppt/pins.json", JSON.stringify(every.filter((p) => !drop.includes(p)), null, 1));
		return { removed: drop.length, left: all.length - drop.length };
	},

	gen: async ({ dir }) => {
		const s = useSettings.getState().s;
		if (s.image.provider === "svg") throw new Error("그림 생성 방식이 SVG 라 그림을 만들지 않는다 — 인라인 SVG 로 그린다 (사용자가 앱 설정에서 바꿀 수 있다)");
		const st = useDeck.getState();
		if (st.running && same(st.dir, dir)) throw new Error("앱 안 Claude 가 이 덱을 고치는 중이다 — status --wait 뒤에 다시 한다");
		const deck = await readDeck(dir);
		let tried = 0;
		const errors = await job(`${titleOf(dir, deck)} · ${tNow("generating")}`, (step) => fillGenerated(dir, deck, s, () => step(++tried, 0)));
		return { filled: tried - errors.length, errors };
	},

	refresh: async ({ dir }) => {
		const st = useDeck.getState();
		if (!same(st.dir, dir)) return { refreshed: false };
		await st.refreshVersions();
		try { useDeck.setState({ releases: JSON.parse(await api.readText(st.dir, "releases/releases.json")) }); } catch {}
		return { refreshed: true };
	},

	open: async ({ dir, slide }) => {
		await show(dir, slide);
		return status();
	},

	new: async ({ title, template, open }) => {
		const s = useSettings.getState().s;
		const t = String(title || "").trim() || tNow("untitled");
		// --template 은 이름(또는 id). 없거나 못 찾으면 「새 덱」 템플릿 — 틀린 이름은 조용히 넘기지 않고 고를 수 있는 이름을 알린다
		const want = String(template || "").trim();
		const tpl = want ? s.templates.find((x) => x.name === want || x.id === want) : undefined;
		if (want && !tpl) throw new Error(`없는 템플릿: ${want} (있는 것: ${s.templates.map((x) => x.name).join(", ")})`);
		const dir = await freeDir(t);
		const deck = await createDeck(dir, t, s, tpl?.id);
		let opened = false;
		if (open && !useDeck.getState().running) {
			await useDeck.getState().openProject(dir);
			opened = true;
		} else {
			await api.commit(dir, "새로 만듦");
		}
		// 바깥 세션은 앱의 시스템 프롬프트를 받지 않는다 — 같은 스타일로 만들게 템플릿 규칙을 돌려준다
		const used = templateOf(s, deck.template);
		return { dir, title: t, opened, template: used.name, style: templateRules(used) };
	},

	import: async ({ path, open }) => {
		const name = String(path).split(/[\\/]/).pop()!;
		const r = await job(name, (step) => importDeck(path, step));
		const opened = !!open && !useDeck.getState().running;
		if (opened) await useDeck.getState().openProject(r.dir);
		return { dir: r.dir, title: r.deck.title, slides: r.deck.slides.length, warnings: r.warnings, opened };
	},

	export: async ({ dir, out, exact }) =>
		withDeck(dir, (id, deck) =>
			job(`${titleOf(dir, deck)} → PPTX`, async (step) => {
				const { buildPptx } = await import("./exportPptx");
				const b = await buildPptx(deck, id, step, !!exact);
				await api.absWriteBytes(out, b.data);
				return { out, slides: deck.slides.length, exact: !!exact, missingFonts: b.missingFonts };
			}),
		),

	shot: async ({ dir, slides, out, scale }) =>
		withDeck(dir, async (id, deck) => {
			const list = pick(deck, slides);
			const files: { no: number; id: string; file: string }[] = [];
			for (const { no, ref } of list) {
				const { win, dispose } = await offscreen(id, ref.file, deck.size.w, deck.size.h);
				let snap: any;
				try { snap = await ask(win, { t: "snapshot", scale: scale || 1 }, 60000); } finally { dispose(); }
				if (snap.error) throw new Error(`${no}쪽: ${snap.error}`);
				const file = join(out, `${no}.png`);
				await api.absWriteBytes(file, bytesFromB64(snap.data.split(",")[1]));
				files.push({ no, id: ref.id, file });
			}
			return { size: deck.size, scale: scale || 1, files };
		}),

	inspect: async ({ dir, slides }) =>
		withDeck(dir, async (id, deck) => {
			const { w: W, h: H } = deck.size;
			const out = [];
			for (const { no, ref } of pick(deck, slides)) {
				const { win, dispose } = await offscreen(id, ref.file, W, H);
				let res: any;
				try { res = await ask(win, { t: "extract" }, 30000); } finally { dispose(); }
				if (res.error) throw new Error(`${no}쪽: ${res.error}`);
				const items: any[] = res.data.items;
				const count: Record<string, number> = {};
				for (const it of items) count[it.type] = (count[it.type] || 0) + 1;
				const r = (v: number) => Math.round(v);
				const boxOf = (it: any) => it.type === "line"
					? { x: r(Math.min(it.x1, it.x2)), y: r(Math.min(it.y1, it.y2)), w: r(Math.abs(it.x2 - it.x1)), h: r(Math.abs(it.y2 - it.y1)) }
					: { x: r(it.x), y: r(it.y), w: r(it.w), h: r(it.h) };
				// 쪽 밖으로 1px 넘게 나간 것 — PPTX 에서는 잘리지 않고 쪽 밖에 그대로 보인다
				const overflow = items
					.map((it) => ({ it, b: boxOf(it) }))
					.filter(({ b }) => b.x < -1 || b.y < -1 || b.x + b.w > W + 1 || b.y + b.h > H + 1)
					.map(({ it, b }) => ({ type: it.type, ...b, text: it.runs ? it.runs.map((x: any) => x.text || "").join("").slice(0, 40) : undefined }));
				out.push({
					no,
					id: ref.id,
					file: ref.file,
					count,
					// 그림으로 굳는 것 — whole: 그 요소와 자식 전부(<img> · <svg> 는 원래 그림이라 괜찮다) · background: 바탕만 그림, 글자는 편집 가능
					baked: items.filter((it) => it.type === "image").map((it) => ({ baked: it.baked, tag: it.tag, ...boxOf(it) })),
					overflow,
					fails: res.data.fails,
				});
			}
			return { size: deck.size, slides: out };
		}),

	check: async ({ dir }) =>
		withDeck(dir, (id, deck) =>
			job(`${titleOf(dir, deck)} · 비교`, async (step) => {
				const log = await api.log(dir, 1);
				let k = 0;
				const { runCheck } = await import("./check");
				const report = await runCheck(dir, id, deck, log[0]?.n ?? 0, () => step(++k, 0));
				return { ...report, slides: report.slides.map((x) => ({ ...x, web: join(dir, x.web), ppt: join(dir, x.ppt), diff: join(dir, x.diff) })) };
			}),
		),

	release: async ({ dir, name, notes }) =>
		withDeck(dir, (id, deck) =>
			job(`${titleOf(dir, deck)} · 릴리즈`, async (step) => {
				let prev: Release[] = [];
				try { prev = JSON.parse(await api.readText(dir, "releases/releases.json")); } catch {}
				const rel = await makeRelease(dir, id, deck, prev, name || "", notes || "", step);
				const st = useDeck.getState();
				if (same(st.dir, dir)) {
					useDeck.setState({ releases: [...prev, rel] });
					await st.refreshVersions();
				}
				return { ...rel, path: join(dir, rel.file) };
			}),
		),
};

let started = false;

/** 설정을 읽은 뒤 한 번 부른다 — 저장 폴더 · 템플릿이 있어야 새 덱을 만든다 */
export async function startRemote() {
	if (started) return;
	started = true;
	await listen<{ id: string; cmd: string; args: Args }>("remote", async (e) => {
		const { id, cmd, args } = e.payload;
		const h = handlers[cmd];
		let reply: unknown;
		try {
			if (!h) throw new Error(`모르는 명령: ${cmd}`);
			reply = { ok: true, data: (await h(args || {})) ?? null };
		} catch (err) {
			reply = { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
		await invoke("remote_reply", { id, reply });
	});
	// 설정 「바깥 연결 › 바깥 제어」를 통로에 알린다 — control.json 을 쓰기 전에, 그리고 바뀔 때마다
	const sync = (on: boolean) => invoke("remote_set_enabled", { on }).catch(() => {});
	await sync(useSettings.getState().s.remote.enabled);
	useSettings.subscribe((x, y) => { if (x.s.remote.enabled !== y.s.remote.enabled) sync(x.s.remote.enabled); });
	await invoke("remote_ready");
}
