// 처음 화면 — 위에 주제 한 줄(쓰면 바로 Claude 가 짓기 시작) · 가져오기 · 열기, 그 아래 최근 덱을 첫 쪽 미리보기 카드로 깐다.
// 창에 끌어 놓기는 DropZone(App 에 하나)이 받는다.
// 2026.11.18 : 최근 목록을 오른쪽 글자 줄에서 화면 대부분을 쓰는 카드로 바꿨다 — 가장 잦은 일이 지난 덱을 여는 것이고, 덱은 모양으로 알아본다.
// 2026.11.26 : 「공유 덱 열기」 — 팀원이 보낸 초대 링크를 브라우저 대신 이 앱의 새 창으로 연다 (collab.rs collab_join). 들어간 곳은 아래 「공유 덱」에 남는다.
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, deckUrl, type LibItem } from "../lib/api";
import { openAny, startNew } from "../lib/flows";
import { useT } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import { useDeck } from "../lib/store";
import { call } from "../lib/transport";
import { openMenu } from "./ContextMenu";
import { originOf, type RunnerState, setMine, useRunners } from "../lib/runner";

/** 공유 덱에 앱으로 들어간다 — 새 창이 뜬다. 들어간 덱 주인을 남겨 다음에는 그것만으로 (기기 쿠키가 앱에 남는다).
 *  앱 링크(claudeppt://<열쇠>)면 열쇠를, 브라우저 링크면 주소를 남긴다 (p2p.rs canon) */
async function joinShared(raw: string) {
	const url = raw.trim();
	if (!url) return false;
	try {
		const canon = await call<string>("collab_join", { url });
		const at = canon.startsWith("claudeppt:") ? canon : canon + "/";
		useSettings.getState().set((s) => ({ ...s, shared: [{ url: at, at: Date.now() }, ...s.shared.filter((x) => x.url !== at)].slice(0, 12) }));
		return true;
	} catch (e) {
		useDeck.getState().notify(String(e), "err");
		return false;
	}
}

/** 저장 폴더 안의 덱인가 — 밖의 덱(최근 목록에만 있는 덱)은 남의 폴더일 수 있어 지우지 않고 목록에서만 뺀다 */
const inLibrary = (dir: string, lib: string) => {
	const n = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
	return !!lib && n(dir).startsWith(n(lib) + "\\");
};

export default function Home() {
	const t = useT();
	const s = useSettings((x) => x.s);
	const busy = useDeck((x) => x.busy);
	const [brief, setBrief] = useState("");
	const [items, setItems] = useState<LibItem[]>([]);
	const [working, setWorking] = useState(false);
	// 덱 카드 우클릭 — 열기 · 폴더 열기 · 지우기(휴지통). 2026.11.26 : 처음 화면에서 덱을 지울 길이 없다는 요청
	const forget = (dir: string) => useSettings.getState().set((v) => ({ ...v, recent: v.recent.filter((d) => d.toLowerCase() !== dir.toLowerCase()) }));
	const deckMenu = (e: React.MouseEvent, it: LibItem) => {
		const title = it.deck?.title || "", folder = it.dir.split(/[\\/]/).pop() || "";
		// 제목이 같은 덱이 여럿일 수 있다(「제목 없음」) — 폴더 이름이 다르면 함께 보여 어느 덱인지 가린다
		const name = !title || title === folder ? folder : `${title} (${folder})`;
		const own = inLibrary(it.dir, s.library);
		openMenu(e, [
			{ label: t("open"), run: () => openAny(it.dir) },
			{ label: t("deckReveal"), run: () => api.reveal(it.dir).catch((x) => useDeck.getState().notify(String(x), "err")) },
			"-",
			own
				? { label: t("deckTrash"), danger: true, run: async () => {
					if (!(await confirm(t("deckTrashAsk").replace("{name}", name), { title: t("deckTrash"), kind: "warning", okLabel: t("deckTrash"), cancelLabel: t("cancel") }))) return;
					try {
						await api.trashDeck(it.dir);
						forget(it.dir);
						setItems((xs) => xs.filter((x) => x.dir !== it.dir));
						useDeck.getState().notify(t("deckTrashed").replace("{name}", name), "ok");
					} catch (x) {
						useDeck.getState().notify(String(x), "err");
					}
				} }
				: { label: t("deckForget"), run: () => { forget(it.dir); setItems((xs) => xs.filter((x) => x.dir !== it.dir)); } },
		]);
	};
	// 이번에 만들 덱의 템플릿 — 처음엔 설정의 「새 덱」 템플릿. 여기서 바꿔도 설정은 그대로 둔다
	const [tpl, setTpl] = useState(s.template);
	// 공유 덱 열기 — 초대 링크 칸
	const [joining, setJoining] = useState(false);
	const [link, setLink] = useState("");
	// 공유 덱 목록의 덱 주인 — 앱 링크는 열쇠 대신 「앱끼리 연결」, 브라우저 링크는 주소
	const where = (u: string) => (u.startsWith("claudeppt:") ? t("sharedViaApp") : u.replace(/^https?:\/\//, "").replace(/\/$/, ""));

	useEffect(() => {
		(async () => {
			const lib = await api.library(s.library).catch(() => []);
			const extra: LibItem[] = [];
			for (const d of s.recent) {
				if (lib.some((l) => l.dir.toLowerCase() === d.toLowerCase())) continue;
				try { extra.push({ dir: d, deck: JSON.parse(await api.readText(d, "deck.json")), modified: 0 }); } catch {}
			}
			const rank = (d: string) => { const i = s.recent.findIndex((r) => r.toLowerCase() === d.toLowerCase()); return i < 0 ? 999 : i; };
			setItems([...lib, ...extra].sort((a, b) => rank(a.dir) - rank(b.dir) || b.modified - a.modified));
		})();
	}, [s.library, s.recent]);


	const go = async () => {
		if (working) return;
		setWorking(true);
		try { await startNew(brief, tpl); } catch (e) { useDeck.getState().notify(String(e), "err"); }
		setWorking(false);
	};
	const pickPptx = async () => {
		const p = await open({ filters: [{ name: "PowerPoint", extensions: ["pptx"] }] });
		if (typeof p === "string") openAny(p);
	};
	const pickDeck = async () => {
		const p = await open({ filters: [{ name: "ClaudePPT", extensions: ["cppt", "json"] }], defaultPath: s.library });
		if (typeof p === "string") openAny(p);
	};

	useEffect(() => {
		const k = (e: KeyboardEvent) => {
			if (!e.ctrlKey) return;
			if (e.key.toLowerCase() === "o") { e.preventDefault(); e.shiftKey ? pickDeck() : pickPptx(); }
		};
		addEventListener("keydown", k);
		return () => removeEventListener("keydown", k);
	});

	return (
		<main className="home">
			{(working || busy) && <div className="progress-line" />}
			<section className="home-top">
				<div className="brief">
					<div className="line">
						<textarea
							id="brief"
							aria-label={t("brief")}
							autoFocus
							rows={1}
							placeholder={t("briefHint")}
							value={brief}
							onChange={(e) => setBrief(e.target.value)}
							onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }}
						/>
						<button className="send" onClick={go} disabled={working}>{brief.trim() ? t("start") : t("new")}<kbd>↵</kbd></button>
					</div>
				</div>
				<div className="home-acts">
					{/* 템플릿이 한 벌뿐이면 고를 것이 없다 — 칸을 띄우지 않는다 */}
					{s.templates.length > 1 && (
						<label className="tpl-pick">
							{t("templatePick")}
							<select value={s.templates.some((x) => x.id === tpl) ? tpl : s.template} onChange={(e) => setTpl(e.target.value)}>
								{s.templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
							</select>
						</label>
					)}
					<button onClick={pickPptx}>{t("openPptx")}<kbd>Ctrl O</kbd></button>
					<button onClick={pickDeck}>{t("openDeck")}<kbd>Ctrl ⇧ O</kbd></button>
					<button onClick={() => setJoining(!joining)} aria-expanded={joining}>{t("joinShared")}</button>
				</div>
				{joining && (
					<form className="join-row" onSubmit={async (e) => { e.preventDefault(); if (await joinShared(link)) { setLink(""); setJoining(false); } }}>
						<input className="field" autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder={t("joinPh")} aria-label={t("joinShared")}
							onKeyDown={(e) => { if (e.key === "Escape") setJoining(false); }} />
						<button className="send" disabled={!link.trim()}>{t("joinGo")}</button>
						<span className="dim">{t("joinNote")}</span>
					</form>
				)}
			</section>
			<section className="home-decks" aria-label={t("recentDecks")}>
				{s.shared.length > 0 && (
					<div className="shared">
						<div className="side-head">{t("sharedDecks")}<span>{s.shared.length}</span></div>
						<div className="shared-list">
							{s.shared.map((x) => (
								<span className="shared-item" key={x.url}>
									<button onClick={() => joinShared(x.url)} title={x.url}>
										{/* 덱 제목은 「내 Claude」가 붙었을 때 덱 주인이 알려 준다 — 모르면 덱 주인 PC 주소 */}
										<b className={x.title ? "t" : ""}>{x.title || where(x.url)}</b>
										<span className="dim">{x.title ? `${where(x.url)} · ` : ""}{new Date(x.at).toLocaleDateString()}</span>
									</button>
									<MineToggle url={x.url} on={!!x.mine} />
									<button className="x" onClick={() => useSettings.getState().set((v) => ({ ...v, shared: v.shared.filter((y) => y.url !== x.url) }))} aria-label={t("delete")} title={t("sharedForget")}>×</button>
								</span>
							))}
						</div>
					</div>
				)}
				<div className="side-head">{t("recentDecks")}<span>{items.length || ""}</span></div>
				{items.length === 0 ? (
					<div className="decks-empty">{t("decksEmpty")}</div>
				) : (
					<div className="decks">
						{items.map((it) => (
							<button key={it.dir} className="deck-card" onClick={() => openAny(it.dir)} title={it.dir} onContextMenu={(e) => deckMenu(e, it)}>
								<DeckThumb item={it} />
								<span className="t">{it.deck?.title || it.dir.split(/[\\/]/).pop()}</span>
								<span className="n">{it.deck?.slides?.length ?? 0}{t("slideN") === "쪽" ? "쪽" : " sl"}</span>
							</button>
						))}
					</div>
				)}
			</section>
		</main>
	);
}

/** 「내 Claude 쓰기」 — 이 덱 주인에게 내 PC 의 Claude 를 붙인다 (runner.ts). 켜면 지금 상태(기다림 · 연결 · 일하는 중)를 함께 */
const RUNNER_LABEL: Record<RunnerState, "runnerWaiting" | "runnerConnected" | "runnerRunning" | "runnerError" | "runnerUse"> = {
	waiting: "runnerWaiting", connected: "runnerConnected", running: "runnerRunning", error: "runnerError", off: "runnerUse",
};
function MineToggle({ url, on }: { url: string; on: boolean }) {
	const t = useT();
	const st = useRunners((r) => r.st[originOf(url)]);
	return (
		<label className={"mine" + (on ? " on" : "") + (st ? " " + st.state : "")} title={st?.detail || t("runnerUseHint")}>
			<input type="checkbox" checked={on} onChange={() => setMine(url, !on).catch((e) => useDeck.getState().notify(String(e), "err"))} />
			<span>{on && st ? t(RUNNER_LABEL[st.state]) : t("runnerUse")}</span>
		</label>
	);
}

/** 최근 덱 카드의 첫 쪽 미리보기. deck:// 은 열어 둔 프로젝트만 내주므로 잠깐 열어 id 를 받고 감시는 바로 끈다
 *  (project_close 는 감시만 끄고 id 는 남긴다). 화면 언저리에 올 때만 띄운다 — 덱이 많으면 iframe 이 쌓인다 */
function DeckThumb({ item }: { item: LibItem }) {
	const ref = useRef<HTMLSpanElement>(null);
	const [width, setWidth] = useState(0);
	const [near, setNear] = useState(false);
	const [id, setId] = useState<string | null>(null);
	const first = item.deck?.slides?.[0]?.file as string | undefined;
	const size = item.deck?.size || { w: 1280, h: 720 };
	useLayoutEffect(() => {
		const el = ref.current!;
		const ro = new ResizeObserver(() => setWidth(el.clientWidth));
		ro.observe(el);
		const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setNear(true); }, { rootMargin: "50% 0px" });
		io.observe(el);
		return () => { ro.disconnect(); io.disconnect(); };
	}, []);
	useEffect(() => {
		if (!near || !first || id) return;
		let gone = false;
		api.open(item.dir).then((x) => { api.close(x).catch(() => {}); if (!gone) setId(x); }, () => {});
		return () => { gone = true; };
	}, [near, first, item.dir]);
	// 카드 틀은 16:9 로 고정하고 쪽은 그 안에 맞춰 넣는다 — 4:3 덱이 섞여도 카드 줄이 고르다
	const boxH = (width * 9) / 16;
	const k = Math.min(width / size.w, boxH / size.h);
	return (
		<span className="dthumb" ref={ref}>
			{id && first && width > 0 && (
				<iframe src={deckUrl(id, first)} title="" tabIndex={-1} width={size.w} height={size.h}
					style={{ transform: `translate(${(width - size.w * k) / 2}px, ${(boxH - size.h * k) / 2}px) scale(${k})` }} />
			)}
		</span>
	);
}
