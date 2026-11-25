// 사용자 제목 줄 — 끌어서 창 옮기기 · 두 번 눌러 최대화. 왼쪽에 처음 · 덱 이름 · 판 번호(누르면 판 목록), 가운데에 한 쪽 · 이어 보기,
// 오른쪽에 내보내기 · 릴리즈 · 설정 · 창 단추.
// 2026.11.18 : 가운데의 보기 · 핀 · 편집 모드를 걷었다 — 무대 도구 띠(고르기 · 펜 · 화살표 · 범위) 하나로 합쳤다.
//              무대 아래 판 줄기(눈금 띠)도 걷고 판 번호를 누르면 여는 판 목록으로 옮겼다 — 눈금이 거의 안 보이면서 자리만 먹었다.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import type { Commit } from "../lib/api";
import { useT } from "../lib/i18n";
import { useDeck } from "../lib/store";
import { useUpdate } from "../lib/updater";
import { openMenu } from "./ContextMenu";
import DeckActions from "./DeckActions";

export const Mark = () => (
	<svg className="mark" viewBox="0 0 16 16" aria-hidden>
		<rect x="1.5" y="4" width="11" height="7.5" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
		<circle cx="12.6" cy="4.2" r="2.6" fill="var(--accent)" />
	</svg>
);

export default function TitleBar({ onSettings, settingsOpen }: { onSettings: () => void; settingsOpen: boolean }) {
	const t = useT();
	const deck = useDeck((s) => s.deck);
	const versions = useDeck((s) => s.versions);
	const releases = useDeck((s) => s.releases);
	const flow = useDeck((s) => s.flow);
	const setFlow = useDeck((s) => s.setFlow);
	const close = useDeck((s) => s.closeProject);
	const saveDeck = useDeck((s) => s.saveDeck);
	const win = getCurrentWindow();
	const [max, setMax] = useState(false);
	const [list, setList] = useState(false);
	useEffect(() => {
		win.isMaximized().then(setMax);
		const un = win.onResized(() => win.isMaximized().then(setMax));
		return () => { un.then((f) => f()); };
	}, []);
	const head = versions[0];
	const lastRel = releases[releases.length - 1];
	const titleRef = useRef<HTMLInputElement>(null);

	return (
		<header className="titlebar" data-tauri-drag-region onDoubleClick={(e) => { if (e.target === e.currentTarget) win.toggleMaximize(); }}>
			<div className="left" data-tauri-drag-region>
				<Mark />
				<div className="crumb">
					{deck ? (
						<>
							<button className="crumb-home" onClick={close}>{t("home")}</button>
							<span className="dim">/</span>
							<input
								ref={titleRef}
								className="title"
								defaultValue={deck.title}
								key={deck.title}
								size={Math.max(4, deck.title.length + 1)}
								aria-label={t("name")}
								onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { (e.target as HTMLInputElement).value = deck.title; (e.target as HTMLInputElement).blur(); } }}
								onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== deck.title) saveDeck({ ...deck, title: v }); }}
							/>
							{head && (
								<span className="stampwrap">
								<button className={"stamp" + (list ? " on" : "")} onClick={() => setList(!list)} title={t("versions")} aria-expanded={list}>
									<b>v{head.n}</b>
									{/* 마지막 릴리즈 — 판 목록과 같은 꼬리표. 그 뒤로 판이 더 쌓였으면 몇 판인지 */}
									{lastRel && <><i className="rtag">{lastRel.tag}</i>{head.n - lastRel.n > 1 ? `+${head.n - lastRel.n - 1}` : ""}</>}
									<span className="caret" aria-hidden>▾</span>
								</button>
								{/* 판 번호 바로 아래로 편다 */}
								{list && <VersionList onClose={() => setList(false)} />}
								</span>
							)}
							<UndoRedo />
						</>
					) : (
						<span className="title" style={{ fontWeight: 600 }}>ClaudePPT</span>
					)}
				</div>
			</div>
			<div className="center">
				{deck && (
					<div className="seg" role="group" aria-label={t("flow")}>
						<button aria-pressed={!flow} onClick={() => setFlow(false)} title={`${t("single")} (S)`}>{t("single")}</button>
						<button aria-pressed={flow} onClick={() => setFlow(true)} title={`${t("flow")} (S)`}>{t("flow")}</button>
					</div>
				)}
			</div>
			<div className="right" data-tauri-drag-region>
				<UpdateChip />
				{deck && <DeckActions />}
				<button className={"tb-btn" + (settingsOpen ? " on" : "")} onClick={onSettings} title={t("settings") + " (Ctrl+,)"} aria-label={t("settings")}>
					<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden><path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><circle cx="10.5" cy="4.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="5.5" cy="11.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
				</button>
				<div className="win">
					<button onClick={() => win.minimize()} aria-label={t("minimize")}><svg width="10" height="10" aria-hidden><path d="M0 5.5h10" stroke="currentColor" /></svg></button>
					<button onClick={() => win.toggleMaximize()} aria-label={t("maximize")}>
						{max ? <svg width="10" height="10" aria-hidden><path d="M2.5.5h7v7M.5 2.5h7v7h-7z" fill="none" stroke="currentColor" /></svg> : <svg width="10" height="10" aria-hidden><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" /></svg>}
					</button>
					<button className="x" onClick={() => win.close()} aria-label={t("quit")}><svg width="10" height="10" aria-hidden><path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" /></svg></button>
				</div>
			</div>
		</header>
	);
}

/** 되돌리기 · 다시 실행 — 손으로 고친 것(끌기 · 방향키 · 글 고치기 · 지우기)만 한 걸음씩. Claude 턴은 판으로 되돌린다.
 *  2026.11.24 : 단축키(Ctrl+Z · Ctrl+Y)만 있어 있는 줄 몰랐다 — 판 번호 옆에 단추로 둔다 */
function UndoRedo() {
	const t = useT();
	const hist = useDeck((s) => s.hist);
	// 지난 판을 보는 중 · Claude 가 고치는 중에는 store 가 받지 않는다 — 단추도 끈다
	const off = useDeck((s) => !!s.preview || !!s.running);
	return (
		<span className="undoredo">
			<button className="tb-btn icon" onClick={() => useDeck.getState().undo()} disabled={off || !hist.u} title={`${t("undo")} (Ctrl+Z)`} aria-label={t("undo")}>
				<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden><path d="M5.5 3 2.5 6l3 3M2.5 6h7a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
			</button>
			<button className="tb-btn icon" onClick={() => useDeck.getState().redo()} disabled={off || !hist.r} title={`${t("redo")} (Ctrl+Y)`} aria-label={t("redo")}>
				<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden><path d="M10.5 3l3 3-3 3M13.5 6h-7a4 4 0 0 0 0 8H9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
			</button>
		</span>
	);
}

/** 판 목록 — 새 판이 위. 누르면 그 판을 무대에서 제자리로 보고(지난 판 띠가 「되돌리기」를 준다), 릴리즈는 꼬리표로.
 *  대화의 v 번호와 같은 판이다. 직접 편집 판처럼 대화에 없는 판도 여기에는 다 있다 */
function VersionList({ onClose }: { onClose: () => void }) {
	const t = useT();
	const versions = useDeck((s) => s.versions);
	const preview = useDeck((s) => s.preview);
	const setPreview = useDeck((s) => s.setPreview);
	const restore = useDeck((s) => s.restore);
	const running = useDeck((s) => s.running);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const k = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".stamp")) onClose(); };
		const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
		addEventListener("mousedown", k);
		addEventListener("keydown", esc);
		return () => { removeEventListener("mousedown", k); removeEventListener("keydown", esc); };
	}, [onClose]);
	const head = versions[0];
	const pick = (c: Commit) => setPreview(c === head || preview?.hash === c.hash ? null : c);
	return (
		<div className="pop versions" ref={ref} role="listbox" aria-label={t("versions")}>
			{versions.map((c) => {
				const rel = c.tags.find((x) => /^r\d+$/.test(x));
				const on = preview ? preview.hash === c.hash : c === head;
				return (
					<button key={c.hash} role="option" aria-selected={on} className={on ? "on" : ""} onClick={() => pick(c)}
						onContextMenu={(e) => openMenu(e, [
							{ label: `v${c.n} ${t("viewVersion")}`, run: () => pick(c), disabled: c === head },
							{ label: t("restore"), run: () => restore(c), disabled: c === head || !!running },
							"-",
							{ label: t("compareWith"), run: () => { onClose(); useDeck.getState().startCompare(c); }, disabled: c === head },
							{ label: `${t("mentionVersion")}`, kbd: `@v${c.n}`, run: () => { onClose(); useDeck.getState().mentionVersion(c.n); }, disabled: c === head },
						])}>
						{/* 대화의 판 알약과 같은 모양 — 지금 판만 채운다 */}
						<span className={"node" + (c === head ? " head" : "")}>v{c.n}</span>
						<span className="s"><span>{c.subject}</span>{rel && <i className="rtag">{rel}</i>}</span>
						<span className="d">{c.date.slice(5, 16)}</span>
					</button>
				);
			})}
		</div>
	);
}

/** 새 판 칩 — 새 판이 있을 때만 제목 줄 오른쪽에 선다. 처음 찾은 판이면 설명을 저절로 펴고(notified), 「나중에」로 접어도 칩은 남는다.
 *  받는 중에는 칩이 진행률이 된다 — 다 받으면 앱이 다시 켜진다 */
function UpdateChip() {
	const t = useT();
	const u = useUpdate();
	const ref = useRef<HTMLSpanElement>(null);
	const [open, setOpen] = useState(false);
	const show = open || u.notified;
	const close = () => { setOpen(false); if (useUpdate.getState().notified) useUpdate.getState().dismiss(); };
	useEffect(() => {
		if (!show) return;
		const k = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
		const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
		addEventListener("mousedown", k);
		addEventListener("keydown", esc);
		return () => { removeEventListener("mousedown", k); removeEventListener("keydown", esc); };
	}, [show]);
	// 받는 중 · 설치 중이면 칩이 진행률 · 상태가 된다. 받아 두었으면(ready) 쉬는 틈에 저절로 설치한다 — 칩의 단추로 바로 설치할 수도 있다
	if (!["available", "downloading", "ready", "installing"].includes(u.phase)) return null;
	const busy = u.phase === "downloading" || u.phase === "installing";
	return (
		<span className="upd" ref={ref}>
			<button className={"upd-chip" + (show ? " on" : "")} onClick={() => (show ? close() : setOpen(true))} disabled={busy} aria-expanded={show}>
				<i aria-hidden />
				{u.phase === "installing" ? t("updateInstalling") : busy ? <span className="mono">{Math.round(u.progress * 100)}%</span> : <>{t("updateReady")} <span className="mono">{u.version}</span></>}
			</button>
			{show && !busy && (
				<div className="pop upd-pop" role="dialog" aria-label={t("update")}>
					<div className="head"><b>ClaudePPT <span className="mono">{u.version}</span></b></div>
					{u.notes && <div className="upd-notes">{u.notes}</div>}
					{u.phase === "ready" && <div className="upd-queued">{t("updateQueued")}</div>}
					<div className="acts">
						<button className="ghost" onClick={close}>{t("updateLater")}</button>
						<button className="send" onClick={() => { close(); u.install(); }}>{t("updateNow")}</button>
					</div>
				</div>
			)}
		</span>
	);
}
