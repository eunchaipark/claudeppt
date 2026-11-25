// 팀 협업 화면 조각 — 제목 줄 접속 칩 · 「설정 › 협업」 칸 · 쪽 목록 · 무대의 「보는 사람」 표시 (상태: lib/collab.ts)
import { useEffect, useRef, useState } from "react";
import { collabKick, collabLinkNew, collabLinkRemove, collabLock, collabTools, collabTunnel, type InviteLink, type TunnelTools, type Member, startHost, stopHost, useCollab } from "../lib/collab";
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
	const { info, members, connected, ended, kicked } = useCollab();
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
				{off ? (kicked ? t("collabKicked") : ended ? t("collabEnded") : t("collabOffline")) : (info?.tunnel ? t("collabOpenOutside") + " · " : "") + t("collabCount").replace("{n}", String(members.length))}
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

/** 「설정 › 협업」 — 켜기 · 초대 링크 · 들어온 사람 · 회의 잠금 (호스트 앱만) */
export function CollabSettings() {
	const t = useT();
	const { info, members } = useCollab();
	// 지금 붙어 있는가는 접속 목록으로 — 장부(info)는 링크 · 기기가 바뀔 때만 새로 온다
	const online = (id: string) => members.some((m) => m.device === id);
	const notify = useDeck((s) => s.notify);
	const [busy, setBusy] = useState(false);
	const [who, setWho] = useState("");
	const [hours, setHours] = useState(0);
	const [tools, setTools] = useState<TunnelTools | null>(null);
	useEffect(() => { if (info) collabTools().then(setTools, () => {}); }, [!!info]);
	const run = async (f: () => Promise<unknown>) => {
		setBusy(true);
		try { await f(); } catch (e) { notify(String(e), "err"); } finally { setBusy(false); }
	};
	const copy = (url: string) => { copyText(url); notify(t("collabCopied"), "ok"); };
	const expiry = (l: InviteLink) => (l.expired ? t("collabExpired") : l.expires ? t("collabUntil").replace("{at}", new Date(l.expires).toLocaleString()) : t("collabNoExpiry"));
	return (
		<div className="collab-set">
			<label className="check">
				<input type="checkbox" checked={!!info} disabled={busy} onChange={() => run(() => (info ? stopHost() : startHost()))} />
				<span>{t("collabOn")}</span>
			</label>
			<p className="note">{t("collabNote")}</p>
			{info && (
				<>
					<p className="note">{t("collabFirewall")}</p>
					<section className="collab-sec">
						<span className="lbl">{t("collabOutside")}</span>
						{info.tunnel ? (
							<div className="field-row">
								<span className="tun on">{info.tunnel.kind === "tailscale" ? "Tailscale Funnel" : "Cloudflare"}</span>
								<input className="field mono" readOnly value={info.tunnel.url} aria-label={t("collabOutside")} />
								<button disabled={busy} onClick={() => run(() => collabTunnel(false))}>{t("collabTunnelOff")}</button>
							</div>
						) : tools && (tools.tailscale || tools.cloudflared) ? (
							<div className="field-row">
								<span className="tun">{t("collabTunnelClosed")}</span>
								<button disabled={busy} onClick={() => run(() => collabTunnel(true))}>{t("collabTunnelOn")}</button>
							</div>
						) : (
							<p className="note">{t("collabNoTools")}</p>
						)}
						<p className="note">{info.tunnel?.kind === "cloudflare" ? t("collabCloudflareNote") : info.tunnel ? t("collabTunnelNote") : t("collabLanOnly")}</p>
					</section>
					<section className="collab-sec">
						<span className="lbl">{t("collabLinks")}</span>
						{info.links.map((l) => (
							<div className={"link-row" + (l.expired ? " expired" : "")} key={l.id}>
								<span className="who">{l.name ? `${t("collabPersonal")} · ${l.name}` : t("collabPublic")}</span>
								<input className="field mono" readOnly value={l.url} onFocus={(e) => e.currentTarget.select()} aria-label={t("collabLink")} />
								<button onClick={() => copy(l.url)} disabled={l.expired}>{t("collabCopy")}</button>
								<button className="rm" onClick={() => run(() => collabLinkRemove(l.id))} title={t("collabLinkRemoveHint")}>{t("delete")}</button>
								<span className="dim when">{expiry(l)}</span>
							</div>
						))}
						<div className="link-new">
							<input className="field" placeholder={t("collabPersonalPh")} value={who} onChange={(e) => setWho(e.target.value)} aria-label={t("collabPersonalPh")} />
							<select className="field" value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label={t("collabExpiry")}>
								<option value={0}>{t("collabNoExpiry")}</option>
								<option value={24}>{t("collabHours24")}</option>
								<option value={168}>{t("collabDays7")}</option>
							</select>
							<button disabled={busy} onClick={() => run(async () => { await collabLinkNew(who.trim() || null, hours || null); setWho(""); })}>{who.trim() ? t("collabMakePersonal") : t("collabMakePublic")}</button>
						</div>
						<p className="note">{t("collabLinkNote")}</p>
					</section>
					<section className="collab-sec">
						<label className="check">
							<input type="checkbox" checked={info.locked} disabled={busy} onChange={() => run(() => collabLock(!info.locked))} />
							<span>{t("collabLock")}</span>
						</label>
						<p className="note">{t("collabLockNote")}</p>
					</section>
					<section className="collab-sec collab-members">
						<span className="lbl">{t("collabPeople")}</span>
						{info.devices.length === 0 && <p className="dim">{t("collabNobody")}</p>}
						{info.devices.map((d) => (
							<div className="row" key={d.id}>
								<Face m={{ conn: 0, device: d.id, name: d.name, slide: null, host: false, since: d.seen }} />
								<span className="nm">{d.name}</span>
								<span className={"st" + (online(d.id) ? " on" : "")}>{online(d.id) ? t("collabOnline") : new Date(d.seen).toLocaleString()}</span>
								<button className="rm" disabled={busy} onClick={() => run(() => collabKick(d.id))} title={t("collabKickHint")}>{t("collabKick")}</button>
							</div>
						))}
					</section>
				</>
			)}
		</div>
	);
}
