// 창에 끌어 놓기 — PPTX 는 새 덱으로 가져오고, CPPT 묶음은 풀어 열고, 프로젝트 폴더는 연다. 처음 화면 · 작업 화면 어디서나 같다.
// 덱을 열어 두었으면 그림 · PDF · 글 파일은 요청에 첨부한다 (attach.ts). 2026.11.25 : 전에는 「가져올 수 없는 파일」로 버렸다.
// 끌고 들어오는 동안 무엇을 놓는지(파일 이름)와 놓으면 어떻게 되는지를 판 하나로 보인다.
// 2026.11.20 : 빨간 점선 테두리에 빨간 글자 한 줄이던 것을 차분한 안내 판으로 바꿨다. 처음 화면 · 작업 화면에 따로 있던 것을 여기 하나로 모았다.
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { remote } from "../lib/transport";
import { useEffect, useState } from "react";
import { attachable, useAttach } from "../lib/attach";
import { importFile, openAny } from "../lib/flows";
import { type Key, useT } from "../lib/i18n";
import { useDeck } from "../lib/store";
import { openTalk } from "./Talk";

type Kind = "pptx" | "cppt" | "folder" | "attach" | "no";

/** 확장자가 없으면 폴더로 본다 — 끌어 놓기 사건은 경로만 주고, 폴더인지 묻자면 느리다 */
const kindOf = (p: string, deckOpen: boolean): Kind => {
	if (/\.pptx$/i.test(p)) return "pptx";
	if (/\.cppt$/i.test(p)) return "cppt";
	if (deckOpen && attachable(p)) return "attach";
	// 덱을 열어 둔 채 폴더를 놓으면 그 덱이 닫힌다 — 작업 중에는 받지 않는다
	if (!/\.[a-z0-9]{1,5}$/i.test(p.split(/[\\/]/).pop() || "") && !deckOpen) return "folder";
	return "no";
};
const LABEL: Record<Kind, Key> = { pptx: "dropPptx", cppt: "dropCppt", folder: "dropFolder", attach: "dropAttach", no: "dropSkip" };

async function take(paths: string[]) {
	const deckOpen = !!useDeck.getState().deck;
	const items = paths.map((p) => ({ p, k: kindOf(p, deckOpen) }));
	// PPTX 는 여러 개를 놓아도 하나씩 가져온다 (각자 진행 막대) — 한꺼번에 돌리면 큰 파일 여럿이 메모리를 다툰다
	const other = items.find((x) => x.k === "cppt" || x.k === "folder");
	const files = items.filter((x) => x.k === "attach").map((x) => x.p);
	if (files.length) { openTalk(); await useAttach.getState().addPaths(files); }
	if (other) await openAny(other.p);
	for (const x of items) if (x.k === "pptx") await importFile(x.p);
}

export default function DropZone() {
	const t = useT();
	const deckOpen = useDeck((s) => !!s.deck);
	const [paths, setPaths] = useState<string[] | null>(null);
	useEffect(() => {
		// 협업 브라우저에는 이 PC 의 파일 경로가 없다 — 끌어 놓기는 호스트 앱만
		if (remote) return;
		const un = getCurrentWebview().onDragDropEvent((e) => {
			const p = e.payload;
			// 글자 · 그림 조각을 끌 때도 enter 가 온다 — 파일이 없으면 판을 띄우지 않는다
			if (p.type === "enter") setPaths(p.paths.length ? p.paths : null);
			else if (p.type === "leave") setPaths(null);
			else if (p.type === "drop") { setPaths(null); if (p.paths.length) take(p.paths); }
		});
		return () => { un.then((f) => f()); };
	}, []);
	if (!paths) return null;
	const items = paths.map((p) => ({ name: p.split(/[\\/]/).pop() || p, k: kindOf(p, deckOpen) }));
	const ok = items.some((x) => x.k !== "no");
	return (
		<div className="dropzone" role="status" aria-live="polite">
			<div className="drop-card">
				<span className="ic" aria-hidden>
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
						{ok ? <path d="M10 3v10m-4-4l4 4 4-4M4 16h12" /> : <path d="M5 5l10 10M15 5L5 15" />}
					</svg>
				</span>
				<b>{ok ? t("dropTitle") : t("dropNo")}</b>
				<ul>
					{items.slice(0, 4).map((x, i) => (
						<li key={i} className={x.k === "no" ? "no" : ""}><span className="f">{x.name}</span><span className="k">{t(LABEL[x.k])}</span></li>
					))}
					{items.length > 4 && <li className="no"><span className="f">+{items.length - 4}</span></li>}
				</ul>
				<span className="hint">{items.some((x) => x.k === "attach") ? t("dropHintAttach") : deckOpen ? t("dropHintOpen") : t("dropHint")}</span>
			</div>
		</div>
	);
}
