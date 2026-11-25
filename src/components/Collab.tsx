// 팀 협업 화면 조각 — 제목 줄 접속 칩 · 「설정 › 협업」 칸 · 쪽 목록 · 무대의 「보는 사람」 표시 (상태: lib/collab.ts)
import { useEffect, useRef, useState } from "react";
import { type Member, startHost, stopHost, useCollab } from "../lib/collab";
import { useT } from "../lib/i18n";
import { useDeck } from "../lib/store";
import { remote } from "../lib/transport";
import { copyText } from "./ContextMenu";

/** 사람 머리글자 — 한글 이름은 앞 글자, 영어는 첫 글자 대문자 */
const initial = (name: string) => (name.trim()[0] || "?").toUpperCase();

/** 같은 이름이 같은 색이 되게 — 주홍(핀 색)은 쓰지 않는다 */
const HUES = [210, 150, 265, 45, 185, 320, 95];
const hue = (name: string) => HUES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

/** 나를 뺀 다른 사람들. 호스트 앱은 호스트(conn 0)가 나, 브라우저는 서버가 준 번호가 나 */
export function useOthers(): Member[] {
	const { members, conn } = useCollab();
	return members.filter((m) => (remote ? m.conn !== conn : !m.host));
}

export function Face({ m, small }: { m: Member; small?: boolean }) {
	const t = useT();
	const name = m.name || t("collabNoName");
	return (
		<i className={"face" + (small ? " sm" : "")} style={{ "--h": hue(name) } as React.CSSProperties} title={name + (m.host ? ` (${t("collabHostTag")})` : "")}>
			{initial(name)}
		</i>
	);
}

/** 쪽 목록 번호 옆 — 이 쪽을 보는 다른 사람 머리글자 */
export function SlideFaces({ slideId }: { slideId: string }) {
	const others = useOthers().filter((m) => m.slide === slideId);
	if (!others.length) return null;
	return (
		<span className="faces">
			{others.slice(0, 3).map((m) => <Face key={m.conn} m={m} small />)}
			{others.length > 3 && <i className="face sm more">+{others.length - 3}</i>}
		</span>
	);
}

/** 무대 위 — 이 쪽을 함께 보는 사람 · 다른 쪽을 보는 사람(누르면 그 쪽으로) */
export function StageFaces({ slideId }: { slideId: string }) {
	const t = useT();
	const others = useOthers();
	const deck = useDeck((s) => s.deck);
	const setCurrent = useDeck((s) => s.setCurrent);
	if (!others.length || !deck) return null;
	const go = (m: Member) => {
		const i = deck.slides.findIndex((s) => s.id === m.slide);
		if (i >= 0) setCurrent(i);
	};
	return (
		<div className="stage-faces" role="group" aria-label={t("collabViewing")}>
			{others.map((m) => {
				const here = m.slide === slideId;
				const no = deck.slides.findIndex((s) => s.id === m.slide) + 1;
				return (
					<button key={m.conn} className={here ? "here" : ""} onClick={() => go(m)} disabled={here || !no} title={here ? `${m.name} · ${t("collabViewing")}` : t("collabFollow").replace("{name}", m.name || t("collabNoName"))}>
						<Face m={m} />
						{!here && no > 0 && <span className="mono">{no}</span>}
					</button>
				);
			})}
		</div>
	);
}

/** 제목 줄 — 협업이 켜졌거나(호스트) 붙어 있으면(브라우저) 사람 수. 누르면 누가 어디를 보는지 */
export function CollabChip() {
	const t = useT();
	const { info, members, connected, ended } = useCollab();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (!open) return;
		const k = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
		addEventListener("mousedown", k);
		return () => removeEventListener("mousedown", k);
	}, [open]);
	if (!remote && !info) return null;
	const deck = useDeck.getState().deck;
	const off = remote && (!connected || ended);
	return (
		<span className="collabwrap" ref={ref}>
			<button className={"tb-btn collab-chip" + (off ? " off" : "")} onClick={() => setOpen(!open)} aria-expanded={open} title={t("collabMembers")}>
				<span className="dot" aria-hidden />
				{off ? (ended ? t("collabEnded") : t("collabOffline")) : t("collabCount").replace("{n}", String(members.length))}
			</button>
			{open && (
				<div className="pop collab-pop" role="dialog" aria-label={t("collabMembers")}>
					{members.length === 0 && <p className="dim">{t("collabNobody")}</p>}
					{members.map((m) => {
						const no = deck ? deck.slides.findIndex((s) => s.id === m.slide) + 1 : 0;
						return (
							<div className="row" key={m.conn}>
								<Face m={m} />
								<span className="nm">{m.name || t("collabNoName")}{m.host && <em> · {t("collabHostTag")}</em>}</span>
								<span className="dim mono">{no > 0 ? `${no}${t("slideN") === "쪽" ? "쪽" : ""}` : ""}</span>
							</div>
						);
					})}
				</div>
			)}
		</span>
	);
}

/** 「설정 › 협업」 — 켜기 · 초대 링크 · 접속한 사람 (호스트 앱만) */
export function CollabSettings() {
	const t = useT();
	const { info, members } = useCollab();
	const notify = useDeck((s) => s.notify);
	const [busy, setBusy] = useState(false);
	const toggle = async () => {
		setBusy(true);
		try {
			if (info) await stopHost();
			else await startHost();
		} catch (e) {
			notify(String(e), "err");
		} finally {
			setBusy(false);
		}
	};
	const link = info?.urls[0];
	return (
		<div className="collab-set">
			<label className="check">
				<input type="checkbox" checked={!!info} disabled={busy} onChange={toggle} />
				<span>{t("collabOn")}</span>
			</label>
			<p className="note">{t("collabNote")}</p>
			{info && (
				<>
					<div className="field-row">
						<span className="lbl">{t("collabLink")}</span>
						<input className="field mono" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={t("collabLink")} />
						<button onClick={() => { copyText(link!); notify(t("collabCopied"), "ok"); }}>{t("collabCopy")}</button>
					</div>
					<p className="note">{t("collabFirewall")}</p>
					<div className="collab-members">
						<span className="lbl">{t("collabMembers")}</span>
						{members.filter((m) => !m.host).length === 0 ? <p className="dim">{t("collabNobody")}</p> : members.filter((m) => !m.host).map((m) => (
							<div className="row" key={m.conn}><Face m={m} /><span>{m.name || t("collabNoName")}</span></div>
						))}
					</div>
				</>
			)}
		</div>
	);
}
