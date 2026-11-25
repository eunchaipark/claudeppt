// 설정 — 오른쪽에서 펴는 판. 왼쪽 낱말 머리로 갈래를 고르고, 오른쪽은 「이름 · 값」 줄.
// 갈래: 일반 · 템플릿(덱 만드는 스타일 한 벌) · Claude · 이미지 · 바깥 연결(앱 밖 Claude Code 의 CLI · 스킬) · 업데이트
// 2026.11.24 : 「도형」 탭을 「템플릿」으로 바꿨다 — 한 벌만 고치던 것을 이름 붙여 여러 벌 두고, 덱마다 어느 것으로 만들었는지 남겨 같은 스타일을 다시 낸다.
//              Claude 탭의 「프롬프트」 · 「추가 지침」 칸은 없앴다 (prompt.ts 머리말).
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, type RemoteInfo, type Tool } from "../lib/api";
import { type Key, useT } from "../lib/i18n";
import { rethemeCss, themeVars, writeDeck } from "../lib/deck";
import { type ImageProvider, type Template, templateId, useSettings } from "../lib/settings";
import { useDeck } from "../lib/store";
import { useUpdate } from "../lib/updater";

type Tab = "general" | "templates" | "claude" | "image" | "connect" | "update";

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
	return (
		<div className="seg" role="group">
			{options.map((o) => <button key={String(o.v)} aria-pressed={o.v === value} onClick={() => onChange(o.v)}>{o.label}</button>)}
		</div>
	);
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
	return <div className="row"><div className="k">{k}</div><div className="v">{children}</div></div>;
}

export default function Settings({ onClose }: { onClose: () => void }) {
	const t = useT();
	const [tab, setTab] = useState<Tab>("general");
	const tabs: Tab[] = ["general", "templates", "claude", "image", "connect", "update"];
	const names: Record<Tab, Key> = { general: "general", templates: "templates", claude: "claude", image: "image", connect: "connect", update: "update" };
	return (
		<div className="settings" role="dialog" aria-label={t("settings")}>
			<nav>
				{tabs.map((x) => <button key={x} className={tab === x ? "on" : ""} onClick={() => setTab(x)}>{t(names[x])}</button>)}
				<button className="close" onClick={onClose}>{t("close")} <span className="mono" style={{ fontSize: 10 }}>Esc</span></button>
			</nav>
			<div className="pane">
				<h3>{t(names[tab])}</h3>
				{tab === "general" && <General />}
				{tab === "templates" && <Templates />}
				{tab === "claude" && <Claude />}
				{tab === "image" && <Images />}
				{tab === "connect" && <Connect />}
				{tab === "update" && <Update />}
			</div>
		</div>
	);
}

function General() {
	const t = useT();
	const { s, set } = useSettings();
	return (
		<>
			<Row k={t("myName")}><input className="field" style={{ maxWidth: 200 }} placeholder={t("myNamePh")} value={s.me} onChange={(e) => set((x) => ({ ...x, me: e.target.value }))} /></Row>
			<Row k=""><span className="note" style={{ whiteSpace: "normal" }}>{t("myNameNote")}</span></Row>
			<Row k={t("language")}><Seg value={s.lang} options={[{ v: "ko", label: "한국어" }, { v: "en", label: "English" }]} onChange={(lang) => set((x) => ({ ...x, lang }))} /></Row>
			<Row k={t("theme")}><Seg value={s.theme} options={[{ v: "system", label: t("themeSystem") }, { v: "dark", label: t("themeDark") }, { v: "light", label: t("themeLight") }]} onChange={(theme) => set((x) => ({ ...x, theme }))} /></Row>
			<Row k={t("libraryDir")}>
				<span className="mono" style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.library}>{s.library}</span>
				<button className="ghost" onClick={() => api.reveal(s.library)}>{t("folder")} ↗</button>
				<button className="ghost" onClick={async () => { const p = await open({ directory: true, defaultPath: s.library }); if (typeof p === "string") set((x) => ({ ...x, library: p })); }}>{t("change")}</button>
			</Row>
			<Row k=""><span className="note" style={{ whiteSpace: "normal" }}>{t("libraryNote")}</span></Row>
		</>
	);
}

function Claude() {
	const t = useT();
	const { s, set } = useSettings();
	const c = s.claude;
	const put = (p: Partial<typeof c>) => set((x) => ({ ...x, claude: { ...x.claude, ...p } }));
	const [found, setFound] = useState<{ path: string; version: string } | null | undefined>(undefined);
	// 경로 칸을 칠 때마다 찾지 않는다 — 멈춘 뒤에 한 번
	useEffect(() => {
		setFound(undefined);
		const t = setTimeout(() => api.claudeDetect(c.path).then(setFound, () => setFound(null)), 400);
		return () => clearTimeout(t);
	}, [c.path]);
	return (
		<>
			<Row k={t("path")}>
				<input className="field mono" style={{ fontSize: 12 }} placeholder={t("auto")} value={c.path} onChange={(e) => put({ path: e.target.value })} />
				<span className={"note" + (found ? " ok" : "")}>{found === undefined ? "…" : found ? found.version.split(" ")[0] : t("noClaude")}</span>
			</Row>
			<Row k={t("model")}>
				<Seg value={["", "opus", "sonnet", "haiku", "fable"].includes(c.model) ? c.model : "custom"} options={[{ v: "", label: t("auto") }, { v: "opus", label: "Opus" }, { v: "sonnet", label: "Sonnet" }, { v: "haiku", label: "Haiku" }, { v: "fable", label: "Fable" }]} onChange={(model) => put({ model })} />
			</Row>
			<Row k={t("effort")}>
				<Seg value={c.effort} options={[{ v: "", label: t("auto") }, { v: "low", label: "low" }, { v: "medium", label: "medium" }, { v: "high", label: "high" }, { v: "xhigh", label: "xhigh" }, { v: "max", label: "max" }]} onChange={(effort) => put({ effort })} />
			</Row>
			<Row k={t("isolation")}><span className="note ok" style={{ whiteSpace: "normal" }}>{t("isolationOn")}</span></Row>
			<Row k=""><span className="note" style={{ whiteSpace: "normal" }}>{t("styleInTemplate")}</span></Row>
		</>
	);
}

function Images() {
	const t = useT();
	const { s, set } = useSettings();
	const im = s.image;
	const put = (p: Partial<typeof im>) => set((x) => ({ ...x, image: { ...x.image, ...p } }));
	const [tools, setTools] = useState<Tool[] | null>(null);
	useEffect(() => { api.toolsDetect().then(setTools, () => setTools([])); }, []);
	const tool = (n: string) => tools?.find((x) => x.name === n);
	const list: { v: ImageProvider; label: Key; st: string; ok: boolean }[] = [
		{ v: "svg", label: "svg", st: "Claude", ok: true },
		{ v: "codex-cli", label: "codexCli", st: tools ? (tool("codex")?.path ? tool("codex")!.version.replace(/^codex-cli\s*/, "") || t("detected") : t("missing")) : "…", ok: !!tool("codex")?.path },
		{ v: "gemini-cli", label: "geminiCli", st: tools ? (tool("gemini")?.path ? tool("gemini")!.version || t("detected") : t("missing")) : "…", ok: !!tool("gemini")?.path },
		{ v: "openai", label: "openaiApi", st: im.openaiKey ? "key" : "", ok: !!im.openaiKey },
		{ v: "gemini", label: "geminiApi", st: im.geminiKey ? "key" : "", ok: !!im.geminiKey },
	];
	return (
		<>
			<div className="row" style={{ alignItems: "start" }}>
				<div className="k" style={{ paddingTop: 8 }}>{t("provider")}</div>
				<div className="v">
					<div className="providers">
						{list.map((p) => (
							<div key={p.v}>
								<button className="provider" aria-pressed={im.provider === p.v} onClick={() => put({ provider: p.v })} style={{ width: "100%" }}>
									<span className="r" /><span>{t(p.label)}</span><span className={"st" + (p.ok ? " ok" : "")}>{p.st}</span>
								</button>
								{im.provider === p.v && p.v === "openai" && (
									<div className="provider-extra">
										<input className="field mono" type="password" placeholder={t("apiKey")} value={im.openaiKey} onChange={(e) => put({ openaiKey: e.target.value })} />
										<input className="field mono" placeholder={t("model")} value={im.openaiModel} onChange={(e) => put({ openaiModel: e.target.value })} />
									</div>
								)}
								{im.provider === p.v && p.v === "gemini" && (
									<div className="provider-extra">
										<input className="field mono" type="password" placeholder={t("apiKey")} value={im.geminiKey} onChange={(e) => put({ geminiKey: e.target.value })} />
										<input className="field mono" placeholder={t("model")} value={im.geminiModel} onChange={(e) => put({ geminiModel: e.target.value })} />
									</div>
								)}
							</div>
						))}
					</div>
				</div>
			</div>
			{im.provider !== "svg" && <Row k=""><span className="note" style={{ whiteSpace: "normal" }}>{t("imageStyleInTemplate")}</span></Row>}
		</>
	);
}

const FONTS = ["Pretendard", "Malgun Gothic", "Noto Sans KR", "KoPubWorld돋움체 Medium", "Nanum Gothic", "Segoe UI"];

/** 템플릿 — 위 목록에서 고칠 것을 고르고, 아래에서 값을 바꾼다. 「새 덱」 표시가 붙은 것이 새로 만드는 덱에 쓰인다.
 *  덱을 열어 두면 템플릿을 그 덱에 입히거나, 그 덱의 글꼴 · 색을 새 템플릿으로 남길 수 있다 (가져온 PPTX 의 모양을 다음 덱에 다시 쓰려고) */
function Templates() {
	const t = useT();
	const { s, set } = useSettings();
	const deck = useDeck((x) => x.deck);
	const dir = useDeck((x) => x.dir);
	const notify = useDeck((x) => x.notify);
	// 덱을 열어 두었으면 그 덱의 템플릿부터 보인다
	const [edit, setEdit] = useState(() => (deck?.template && s.templates.some((x) => x.id === deck.template) ? deck.template : s.template));
	const sh = s.templates.find((x) => x.id === edit) || s.templates[0];
	const put = (p: Partial<Template>) => set((x) => ({ ...x, templates: x.templates.map((y) => (y.id === sh.id ? { ...y, ...p } : y)) }));
	const add = (from: Template, name: string) => {
		const n: Template = { ...from, id: templateId(), name };
		set((x) => ({ ...x, templates: [...x.templates, n] }));
		setEdit(n.id);
	};
	const remove = () => {
		if (s.templates.length < 2) return;
		const rest = s.templates.filter((x) => x.id !== sh.id);
		set((x) => ({ ...x, templates: rest, template: x.template === sh.id ? rest[0].id : x.template }));
		setEdit(rest[0].id);
	};
	const fromDeck = async () => {
		if (!deck) return;
		try {
			add({ ...sh, ...themeVars(await api.readText(dir, "theme.css")), guide: "", imageStyle: "" }, deck.title);
		} catch (e) { notify(String(e), "err"); }
	};
	const applyToDeck = async () => {
		if (!deck) return;
		// theme.css 는 :root 변수만 바꾸고, deck.json 에 템플릿을 남긴다 — 다음 턴부터 이 템플릿의 지침이 실린다 (prompt.ts)
		try {
			await api.writeText(dir, "theme.css", rethemeCss(await api.readText(dir, "theme.css"), sh));
			await writeDeck(dir, { ...deck, template: sh.id });
			notify(`${sh.name} → ${deck.title}`);
		} catch (e) { notify(String(e), "err"); }
	};
	return (
		<>
			<div className="tpl-list" role="listbox" aria-label={t("templates")}>
				{s.templates.map((x) => (
					<button key={x.id} role="option" aria-selected={x.id === sh.id} onClick={() => setEdit(x.id)}>
						<span className="dots">{[x.paper, x.ink, x.accent].map((c, i) => <i key={i} style={{ background: c }} />)}</span>
						<span className="n">{x.name || t("untitled")}</span>
						{deck?.template === x.id && <span className="tag">{t("thisDeck")}</span>}
						{x.id === s.template && <span className="tag on">{t("forNewDecks")}</span>}
					</button>
				))}
				<button className="add" onClick={() => add(sh, `${sh.name} 2`)}>+ {t("duplicateTemplate")}</button>
			</div>
			<Row k={t("name")}>
				<input className="field" value={sh.name} onChange={(e) => put({ name: e.target.value })} />
				{sh.id !== s.template && <button className="ghost" onClick={() => set((x) => ({ ...x, template: sh.id }))}>{t("useForNew")}</button>}
				<button className="ghost" disabled={s.templates.length < 2} onClick={remove}>{t("delete")}</button>
			</Row>
			<Row k={t("font")}>
				<select className="field" value={FONTS.includes(sh.font) ? sh.font : ""} onChange={(e) => e.target.value && put({ font: e.target.value })}>
					{FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
					<option value="">…</option>
				</select>
				<input className="field" style={{ maxWidth: 160 }} value={sh.font} onChange={(e) => put({ font: e.target.value })} />
			</Row>
			<Row k={t("palette")}>
				{(["ink", "paper", "accent"] as const).map((k) => (
					<label key={k} style={{ display: "flex", gap: 6, alignItems: "center", marginRight: 10 }}>
						<span className="swatch" style={{ background: sh[k] }}><input type="color" value={sh[k]} onChange={(e) => put({ [k]: e.target.value.toUpperCase() })} aria-label={t(k)} /></span>
						<span className="note">{t(k)}</span>
					</label>
				))}
			</Row>
			<Row k={t("radius")}><div className="range"><input type="range" min={0} max={32} value={sh.radius} onChange={(e) => put({ radius: +e.target.value })} /><span>{sh.radius}px</span></div></Row>
			<Row k={t("stroke")}><div className="range"><input type="range" min={0.5} max={4} step={0.5} value={sh.stroke} onChange={(e) => put({ stroke: +e.target.value })} /><span>{sh.stroke}px</span></div></Row>
			<Row k={t("shadow")}><Seg value={sh.shadow} options={[{ v: "none", label: t("none") }, { v: "soft", label: t("soft") }]} onChange={(shadow) => put({ shadow })} /></Row>
			<Row k={t("iconStyle")}><Seg value={sh.icon} options={[{ v: "line", label: t("line") }, { v: "solid", label: t("solid") }]} onChange={(icon) => put({ icon })} /></Row>
			<Specimen sh={sh} />
			<div className="row" style={{ alignItems: "start" }}>
				<div className="k" style={{ paddingTop: 8 }}>{t("guide")}</div>
				<div className="v">
					<textarea className="field" rows={6} placeholder={t("guideHint")} value={sh.guide} onChange={(e) => put({ guide: e.target.value })} />
				</div>
			</div>
			<Row k={t("imageStyle")}>
				<input className="field" placeholder="flat editorial illustration, muted palette" value={sh.imageStyle} onChange={(e) => put({ imageStyle: e.target.value })} />
				{s.image.provider === "svg" && <span className="note">{t("imageStyleSvg")}</span>}
			</Row>
			{deck && (
				<Row k={t("openDeckRow")}>
					<button className="ghost" onClick={applyToDeck} title={deck.title}>{t("applyToDeck")}</button>
					<button className="ghost" onClick={fromDeck} title={deck.title}>{t("templateFromDeck")}</button>
				</Row>
			)}
		</>
	);
}

/** 지금 설정으로 그린 작은 견본 쪽 — 바꾸는 즉시 따라 바뀐다 */
function Specimen({ sh }: { sh: Template }) {
	const sw = sh.stroke;
	const icon = (d: string) => sh.icon === "line"
		? <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={sh.ink} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
		: <svg width="26" height="26" viewBox="0 0 24 24" fill={sh.ink}><path d={d} /></svg>;
	return (
		<div className="specimen" style={{ background: sh.paper, color: sh.ink, fontFamily: `"${sh.font}", "Malgun Gothic", sans-serif` }}>
			<div style={{ position: "absolute", left: "6%", top: "14%", fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Aa 가나 123</div>
			<div style={{ position: "absolute", left: "6%", top: "34%", fontSize: 11, opacity: 0.6 }}>{sh.font}</div>
			<div style={{ position: "absolute", left: "6%", bottom: "14%", display: "flex", gap: 10 }}>
				{[0, 1, 2].map((i) => (
					<div key={i} style={{ width: 70, height: 46, borderRadius: sh.radius * 0.5, border: `${sw}px solid ${i === 1 ? sh.accent : "color-mix(in srgb, " + sh.ink + " 18%, " + sh.paper + ")"}`, background: i === 1 ? `color-mix(in srgb, ${sh.accent} 10%, ${sh.paper})` : "transparent", boxShadow: sh.shadow === "soft" ? "0 4px 12px rgba(0,0,0,.10)" : "none" }} />
				))}
			</div>
			<div style={{ position: "absolute", right: "6%", top: "16%", display: "flex", gap: 12 }}>
				{icon("M4 12h16M12 4v16")}
				{icon("M12 3l8 4.5v9L12 21l-8-4.5v-9z")}
				{icon("M5 19V9m7 10V5m7 14v-7")}
			</div>
			<div style={{ position: "absolute", right: "6%", bottom: "14%", width: 120, height: 8, borderRadius: 4, background: sh.accent }} />
		</div>
	);
}

/** 바깥 연결 — 앱 밖 Claude Code 가 스킬 「claudeppt」와 CLI 로 이 앱을 부린다 (control.rs · cli.rs · remote.ts).
 *  스킬은 실행 파일에 담겨 있어 앱을 새 판으로 올리면 깔린 스킬과 어긋난다 — 그때 「다시 깔기」 */
function Connect() {
	const t = useT();
	const { s, set } = useSettings();
	const notify = useDeck((x) => x.notify);
	const [info, setInfo] = useState<RemoteInfo | null>(null);
	const [busy, setBusy] = useState(false);
	const load = () => api.remoteInfo().then(setInfo, () => {});
	useEffect(() => {
		load();
		// 바깥 명령이 끝날 때마다 최근 명령을 다시 읽는다
		const un = listen("remote-log", () => load());
		return () => { un.then((f) => f()); };
	}, []);
	useEffect(() => { load(); }, [s.remote.enabled]);
	if (!info) return null;
	const sk = info.skill;
	const exe = sk.exe.replace(/\//g, "\\");
	const install = async () => {
		setBusy(true);
		try { await api.skillInstall(); await load(); notify(`${t("skill")} · ${t("skillCurrent")}`); }
		catch (e) { notify(String(e), "err"); }
		finally { setBusy(false); }
	};
	const name = (dir: string) => dir.split(/[\\/]/).pop() || dir;
	return (
		<>
			<Row k={t("remoteControl")}>
				<Seg value={s.remote.enabled ? 1 : 0} options={[{ v: 1, label: t("remoteOn") }, { v: 0, label: t("remoteOff") }]} onChange={(v) => set((x) => ({ ...x, remote: { enabled: !!v } }))} />
				<span className={"note" + (s.remote.enabled ? " mono" : "")}>{s.remote.enabled ? `127.0.0.1:${info.port}` : t("remoteOffNote")}</span>
			</Row>
			<Row k={t("skill")}>
				<span className={"note" + (sk.current ? " ok" : "")} style={sk.installed && !sk.current ? { color: "var(--err)" } : undefined}>
					{!sk.installed ? t("skillMissing") : sk.current ? t("skillCurrent") : t("skillStale")}
				</span>
				<button className={sk.current ? "ghost" : "send"} style={{ marginLeft: "auto" }} disabled={busy} onClick={install}>{sk.installed ? t("reinstall") : t("install")}</button>
				{sk.installed && <button className="ghost" onClick={() => api.reveal(sk.dir)}>{t("folder")} ↗</button>}
			</Row>
			{sk.installed && !sk.current && sk.linked && sk.linked !== sk.exe && (
				<Row k="">
					<span className="note mono" style={{ whiteSpace: "normal", wordBreak: "break-all" }} title={`${sk.linked} → ${sk.exe}`}>{sk.linked}<br />→ {sk.exe}</span>
				</Row>
			)}
			<Row k={t("howTo")}><span style={{ whiteSpace: "normal", lineHeight: 1.55 }}>{t("howToText")}</span></Row>
			<Row k={t("cliPath")}>
				<span className="mono" style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={exe}>{exe}</span>
				<button className="ghost" onClick={() => navigator.clipboard.writeText(`"${exe}" help`).then(() => notify(t("copy")), () => {})}>{t("copy")}</button>
			</Row>
			<div className="row" style={{ alignItems: "start" }}>
				<div className="k">{t("recentCli")}</div>
				<div className="v" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
					{!info.recent.length && <span className="note">{t("noRecent")}</span>}
					{[...info.recent].reverse().slice(0, 12).map((r, i) => (
						<div key={i} style={{ display: "grid", gridTemplateColumns: "62px 60px 1fr auto", gap: 8, alignItems: "baseline", fontSize: 12 }} title={r.error || r.dir}>
							<span className="mono" style={{ color: "var(--faint)" }}>{r.at}</span>
							<span className="mono">{r.cmd}</span>
							<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: r.ok ? "var(--dim)" : "var(--err)" }}>{r.ok ? name(r.dir) : r.error}</span>
							<span className="mono" style={{ color: "var(--faint)" }}>{r.ms < 1000 ? `${r.ms}ms` : `${(r.ms / 1000).toFixed(1)}s`}</span>
						</div>
					))}
				</div>
			</div>
		</>
	);
}

function Update() {
	const t = useT();
	const { s, set } = useSettings();
	const u = useUpdate();
	const [ver, setVer] = useState("");
	useEffect(() => { getVersion().then(setVer); }, []);
	return (
		<>
			<Row k={t("version")}><span className="mono">{ver}</span></Row>
			<Row k={t("autoCheck")}><Seg value={s.update.auto ? 1 : 0} options={[{ v: 1, label: t("remoteOn") }, { v: 0, label: t("remoteOff") }]} onChange={(v) => set((x) => ({ ...x, update: { ...x.update, auto: !!v } }))} /></Row>
			<Row k={t("autoInstall")}><Seg value={s.update.install ? 1 : 0} options={[{ v: 1, label: t("remoteOn") }, { v: 0, label: t("remoteOff") }]} onChange={(v) => set((x) => ({ ...x, update: { ...x.update, install: !!v } }))} /><span className="note" style={{ whiteSpace: "normal" }}>{t("autoInstallHint")}</span></Row>
			<Row k={t("check")}>
				<button className="ghost" onClick={() => u.run()} disabled={u.phase === "checking" || u.phase === "downloading"}>{t("check")}</button>
				{u.phase === "latest" && <span className="note ok">{t("latest")}</span>}
				{u.phase === "checking" && <span className="note">…</span>}
				{(u.phase === "available" || u.phase === "ready") && <><span className="mono">{u.version}</span><button className="send" onClick={u.install}>{t("install")}</button></>}
				{u.phase === "ready" && <span className="note">{t("updateQueued")}</span>}
				{u.phase === "downloading" && <span className="mono">{Math.round(u.progress * 100)}%</span>}
				{u.phase === "installing" && <span className="note">{t("updateInstalling")}</span>}
				{u.phase === "error" && <span className="note" style={{ color: "var(--err)", whiteSpace: "normal" }}>{u.error}</span>}
			</Row>
			{u.notes && <Row k={t("notes")}><span style={{ whiteSpace: "pre-wrap" }}>{u.notes}</span></Row>}
		</>
	);
}
