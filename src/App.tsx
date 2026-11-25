import { useEffect, useState } from "react";
import { ContextMenu, useDefaultMenu } from "./components/ContextMenu";
import Crash from "./components/Crash";
import DropZone from "./components/DropZone";
import Home from "./components/Home";
import Settings from "./components/Settings";
import TitleBar from "./components/TitleBar";
import Workspace from "./components/Workspace";
import { useT } from "./lib/i18n";
import { connect, resumeHost, useCollab } from "./lib/collab";
import { startRemote } from "./lib/remote";
import { remote } from "./lib/transport";
import { useSettings } from "./lib/settings";
import { useDeck } from "./lib/store";
import { resumeAfterUpdate, useAutoUpdate } from "./lib/updater";

function useTheme() {
	const theme = useSettings((s) => s.s.theme);
	useEffect(() => {
		const mq = matchMedia("(prefers-color-scheme: light)");
		const apply = () => {
			const t = theme === "system" ? (mq.matches ? "light" : "dark") : theme;
			document.documentElement.dataset.theme = t;
			try { localStorage.setItem("theme-resolved", t); } catch {}
		};
		apply();
		mq.addEventListener("change", apply);
		return () => mq.removeEventListener("change", apply);
	}, [theme]);
}

export default function App() {
	const loaded = useSettings((s) => s.loaded);
	const load = useSettings((s) => s.load);
	const lang = useSettings((s) => s.s.lang);
	const open = useDeck((s) => !!s.deck);
	const [settings, setSettings] = useState(false);
	useEffect(() => { load(); }, [load]);
	useEffect(() => { document.documentElement.lang = lang; }, [lang]);
	useTheme();
	useAutoUpdate(loaded);
	// 앱 밖 Claude Code 의 CLI 명령을 받기 시작한다 — 저장 폴더 · 템플릿을 읽은 뒤라야 새 덱을 만든다
	useEffect(() => { if (loaded && !remote) startRemote().catch((e) => console.error("제어 통로", e)); }, [loaded]);
	// 업데이트를 설치하며 다시 켰으면 그때 열려 있던 덱을 다시 연다
	useEffect(() => { if (loaded && !remote) resumeAfterUpdate(); }, [loaded]);
	// 협업 브라우저 — 호스트 서버에 붙어 덱 · 대화를 받는다 (collab.ts)
	useEffect(() => { if (loaded && remote) connect(); }, [loaded]);
	useEffect(() => { if (loaded && !remote) resumeHost().catch(() => {}); }, [loaded]);
	useEffect(() => {
		const k = (e: KeyboardEvent) => {
			if (e.ctrlKey && e.key === "," && !remote) { e.preventDefault(); setSettings((v) => !v); }
			if (e.key === "Escape" && settings) setSettings(false);
			// 되돌리기 · 다시 하기 — 글 칸 안에서는 그 칸의 되돌리기를 쓴다
			const z = e.key.toLowerCase();
			if (e.ctrlKey && !e.altKey && (z === "z" || z === "y") && !settings) {
				const a = document.activeElement as HTMLElement | null;
				if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
				const d = useDeck.getState();
				// 긋는 도구일 때 Ctrl+Z 는 마지막 표시 지우기다 (Workspace Stage) — 파일 되돌리기와 겹쳐 돌지 않게
				if (d.mode === "pin") return;
				e.preventDefault();
				if (z === "y" || e.shiftKey) d.redo(); else d.undo();
			}
		};
		addEventListener("keydown", k);
		return () => removeEventListener("keydown", k);
	}, [settings]);
	// WebView 기본 우클릭 메뉴(뒤로 · 새로 고침) 대신 앱 메뉴 — 영역마다 제 항목을 열고, 남은 우클릭(입력칸 · 고른 글)은 여기서 받는다
	useDefaultMenu();
	if (!loaded) return <div className="app" />;
	return (
		<div className="app">
			<TitleBar onSettings={() => setSettings((v) => !v)} settingsOpen={settings} />
			{/* 제목 줄 밖에서 오류를 받는다 — 제목 줄이 남아야 창을 닫거나 옮길 수 있다 */}
			<Crash>
				{open ? <Workspace /> : remote ? <RemoteWaiting /> : <Home />}
				{settings && <Settings onClose={() => setSettings(false)} />}
			</Crash>
			<Toasts />
			<ContextMenu />
			<DropZone />
		</div>
	);
}

function Toasts() {
	const toast = useDeck((s) => s.toast);
	const busy = useDeck((s) => s.busy);
	const jobs = useDeck((s) => s.jobs);
	const t = useT();
	return (
		<>
			{busy && <div className="busy" role="status">{busy}<div className="progress-line" /></div>}
			{toast && !busy && (
				<div className={"toast " + toast.kind} role="status">
					<span>{toast.text}</span>
					{toast.action && <button onClick={() => { toast.action!.run(); useDeck.setState({ toast: null }); }}>{toast.action.label}</button>}
					{toast.sticky && <button className="dim" onClick={() => useDeck.setState({ toast: null })} aria-label={t("close")}>{t("close")}</button>}
				</div>
			)}
			{jobs.length > 0 && (
				<div className="jobs" role="status" aria-live="polite">
					{jobs.map((j) => (
						<div className="job" key={j.id}>
							<div className="head">
								<span className="label" title={j.label}>{j.label}</span>
								<span className="mono">{j.n ? `${j.i}/${j.n}${t("slideN") === "쪽" ? "쪽" : ""}` : j.note ? "" : t("importRead")}</span>
							</div>
							<div className={"bar" + (j.n ? "" : " unknown")} role="progressbar" aria-label={`${t("importing")} ${j.label}`} aria-valuemin={0} aria-valuemax={j.n || undefined} aria-valuenow={j.n ? j.i : undefined}>
								<i style={j.n ? { width: `${(j.i / j.n) * 100}%` } : undefined} />
							</div>
							{j.note && <div className="detail" title={j.note}>{j.note}</div>}
						</div>
					))}
				</div>
			)}
		</>
	);
}

/** 협업 브라우저 — 호스트가 덱을 열기 전 · 연결이 끊긴 동안 */
function RemoteWaiting() {
	const t = useT();
	const { connected, ended } = useCollab();
	return (
		<main className="remote-wait">
			<p>{ended ? t("collabEnded") : connected ? t("collabWaiting") : t("collabOffline")}</p>
		</main>
	);
}
