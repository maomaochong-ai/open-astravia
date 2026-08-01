import { useActivityTab, useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseStatus } from "../git/parseStatus";
import { initRepo, resolveRepoRoot, statusPorcelain } from "../git/run";
import { onRefreshSignal } from "../git/runtime";
import type { ChangeEntry } from "../git/types";
import { GitChanges } from "./GitChanges";
import { GraphView } from "./graph/GraphView";
import { GitIcon, GraphIcon, RefreshIcon } from "./icons";
import { InitRepoCta } from "./InitRepoCta";

type ViewTab = "changes" | "graph";

type State =
	| { kind: "loading" }
	| { kind: "no-cwd" }
	| { kind: "not-repo" }
	| { kind: "ready"; root: string; entries: ChangeEntry[] }
	| { kind: "error"; message: string };

export function GitPanel(): JSX.Element {
	const { cwd } = useActivityTab();
	const { t } = useTranslation();
	const [state, setState] = useState<State>({ kind: "loading" });
	const [view, setView] = useState<ViewTab>("changes");
	const [graphReloadToken, setGraphReloadToken] = useState(0);
	const loadIdRef = useRef(0);

	const load = useCallback(async (): Promise<void> => {
		const id = ++loadIdRef.current;
		if (!cwd) {
			setState({ kind: "no-cwd" });
			return;
		}
		try {
			const root = await resolveRepoRoot(cwd);
			if (id !== loadIdRef.current) return;
			if (!root) {
				setState({ kind: "not-repo" });
				return;
			}
			const raw = await statusPorcelain(root);
			if (id !== loadIdRef.current) return;
			setState({ kind: "ready", root, entries: parseStatus(raw) });
		} catch (err) {
			if (id !== loadIdRef.current) return;
			setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
		}
	}, [cwd]);

	// Initial + cwd change.
	useEffect(() => {
		setState({ kind: "loading" });
		void load();
	}, [load]);

	// Refresh on global signals (agent turn-end) and when the window regains focus.
	useEffect(() => {
		const off = onRefreshSignal(() => void load());
		const onFocus = (): void => void load();
		window.addEventListener("focus", onFocus);
		return () => {
			off();
			window.removeEventListener("focus", onFocus);
		};
	}, [load]);

	const handleInit = useCallback(async (): Promise<void> => {
		if (!cwd) return;
		await initRepo(cwd);
		await load();
	}, [cwd, load]);

	const count = state.kind === "ready" ? state.entries.length : null;

	const handleRefresh = useCallback(() => {
		if (view === "graph") setGraphReloadToken((n) => n + 1);
		else void load();
	}, [view, load]);

	const seg = (active: boolean): string =>
		`flex items-center gap-1 rounded px-2 py-0.5 transition-colors ${
			active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
		}`;

	return (
		<div className="flex h-full flex-col">
			<div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
				{state.kind === "ready" ? (
					<div className="flex items-center rounded-md bg-muted/60 p-0.5 text-[11px] font-medium">
						<button type="button" onClick={() => setView("changes")} className={seg(view === "changes")}>
							<GitIcon className="h-3 w-3" />
							{t("view.tabChanges")}
							{count !== null && <span className="text-muted-foreground">{count}</span>}
						</button>
						<button type="button" onClick={() => setView("graph")} className={seg(view === "graph")}>
							<GraphIcon className="h-3 w-3" />
							{t("view.tabGraph")}
						</button>
					</div>
				) : (
					<div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
						<GitIcon className="h-3.5 w-3.5 text-muted-foreground" />
						{t("panel.title")}
					</div>
				)}
				<Button type="button" variant="ghost" size="icon-xs" onClick={handleRefresh} title={t("action.refresh")}>
					<RefreshIcon className="h-3.5 w-3.5" />
				</Button>
			</div>

			{state.kind === "loading" && <div className="px-3 py-4 text-[12px] text-muted-foreground">{t("state.loading")}</div>}
			{state.kind === "no-cwd" && <div className="px-3 py-4 text-[12px] text-muted-foreground">{t("state.noCwd")}</div>}
			{state.kind === "error" && <div className="px-3 py-4 text-[12px] text-rose-500">{state.message}</div>}
			{state.kind === "not-repo" && <InitRepoCta onInit={handleInit} />}
			{state.kind === "ready" &&
				(view === "graph" ? (
					<GraphView root={state.root} reloadToken={graphReloadToken} />
				) : (
					<GitChanges root={state.root} entries={state.entries} />
				))}
		</div>
	);
}
