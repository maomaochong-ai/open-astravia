import { useActivityTab, useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type EngineProgress,
	startDesignServer,
	stopDesignServer,
} from "../engine/engine-manager";
import { exportDesign } from "../export/export-design";
import { getPluginCtx, notify } from "../plugin-context";
import { DesignSession } from "../vetd/design-session";
import { findVetdFiles, sniffVetdKind } from "../vetd/discover";
import { scaffoldDesign } from "../vetd/scaffold";
import { BridgeHub } from "./bridge-client";
import { clearFrameActivity, setCanvasController, setPendingDesignPath, takePendingDesignPath } from "./design-runtime";
import { DesignCanvas } from "./DesignCanvas";
import { ThemePalette } from "./ThemePalette";

type Phase =
	| { kind: "idle" }
	| { kind: "preparing"; progress: EngineProgress }
	| { kind: "ready"; port: number }
	| { kind: "error"; message: string };

function storageKey(cwd: string): string {
	return `vetta-ui-design:file:${cwd}`;
}

export function CanvasTab() {
	const { cwd } = useActivityTab();
	const { t } = useTranslation();
	const [files, setFiles] = useState<string[]>([]);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [phase, setPhase] = useState<Phase>({ kind: "idle" });
	const [session, setSession] = useState<DesignSession | null>(null);
	const [showPalette, setShowPalette] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [reloadNonce, setReloadNonce] = useState(0);
	const bridgeRef = useRef(new BridgeHub());

	const refreshFiles = useCallback(async (): Promise<string[]> => {
		if (!cwd) {
			setFiles([]);
			return [];
		}
		const ctx = getPluginCtx();
		const found: string[] = [];
		for (const path of await findVetdFiles(ctx.fs, cwd)) {
			try {
				const head = (await ctx.fs.readFile(path)).content.slice(0, 64);
				if (sniffVetdKind(head) === "working") found.push(path);
			} catch {
				// unreadable: skip
			}
		}
		setFiles(found);
		return found;
	}, [cwd]);

	// Scope switch: rescan and restore the remembered selection for this cwd.
	useEffect(() => {
		let cancelled = false;
		void refreshFiles().then((found) => {
			if (cancelled) return;
			const pending = takePendingDesignPath();
			const remembered = cwd ? localStorage.getItem(storageKey(cwd)) : null;
			const candidate =
				(pending && found.includes(pending) ? pending : null) ??
				(remembered && found.includes(remembered) ? remembered : null) ??
				found[0] ??
				null;
			setSelectedPath(candidate);
		});
		return () => {
			cancelled = true;
		};
	}, [cwd, refreshFiles]);

	// Open the selected design: session + engine server; teardown on switch.
	useEffect(() => {
		if (!selectedPath || !cwd) {
			setSession(null);
			setPhase({ kind: "idle" });
			return;
		}
		localStorage.setItem(storageKey(cwd), selectedPath);
		const ctx = getPluginCtx();
		const nextSession = new DesignSession(ctx, selectedPath);
		let cancelled = false;
		setPhase({ kind: "preparing", progress: { phase: "checking" } });
		setSession(nextSession);
		void (async () => {
			await nextSession.open();
			const server = await startDesignServer(ctx, nextSession.dirPath, (progress) => {
				if (!cancelled) setPhase({ kind: "preparing", progress });
			});
			if (cancelled) return;
			setCanvasController({
				session: nextSession,
				port: server.port,
				captureFrame: (frameId) => bridgeRef.current.capture(frameId),
				openDesign: (vetdPath) => {
					setPendingDesignPath(vetdPath);
					void refreshFiles().then(() => setSelectedPath(vetdPath));
				},
			});
			setPhase({ kind: "ready", port: server.port });
		})().catch((error: unknown) => {
			if (cancelled) return;
			setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
			notify({ message: t("engine.status.error"), error });
		});
		return () => {
			cancelled = true;
			nextSession.dispose();
			setCanvasController(null);
			clearFrameActivity();
			void stopDesignServer(nextSession.dirPath);
		};
	}, [selectedPath, cwd, t, refreshFiles, reloadNonce]);

	const createDesign = async (): Promise<void> => {
		if (!cwd) return;
		try {
			const ctx = getPluginCtx();
			const result = await scaffoldDesign(ctx.fs, cwd, "design");
			notify({ message: t("create.done", { path: result.vetdPath }), variant: "success", durationMs: 4000 });
			await refreshFiles();
			setSelectedPath(result.vetdPath);
		} catch (error) {
			notify({ message: t("create.failed"), error });
		}
	};

	const runExport = async (): Promise<void> => {
		if (!session || exporting) return;
		setExporting(true);
		try {
			const path = await exportDesign(getPluginCtx(), session);
			notify({ message: t("canvas.export.done", { path }), variant: "success", durationMs: 6000 });
		} catch (error) {
			notify({ message: t("canvas.export.failed"), error });
		} finally {
			setExporting(false);
		}
	};

	const progressText = useMemo(() => {
		if (phase.kind !== "preparing") return "";
		switch (phase.progress.phase) {
			case "checking":
				return t("engine.status.checking");
			case "materializing":
				return t("engine.status.materializing");
			case "installing":
				return t("engine.status.installing");
			case "starting":
				return t("engine.status.starting");
		}
	}, [phase, t]);

	if (files.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
				<span className="text-sm font-medium text-foreground">
					{t("canvas.empty.title")}
				</span>
				<p className="max-w-64 text-xs text-muted-foreground">{t("canvas.empty.desc")}</p>
				<button
					type="button"
					onClick={() => void createDesign()}
					className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
				>
					{t("canvas.empty.create")}
				</button>
			</div>
		);
	}

	return (
		<div className="relative flex h-full flex-col">
			{/* 沉浸式标题栏：浮在画布之上，底色由主题变量渐隐到透明。 */}
			<div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-2 bg-gradient-to-b from-background via-background/80 to-transparent px-3 pb-6 pt-2">
				<label className="pointer-events-auto ml-auto flex min-w-0 max-w-64 items-center gap-2 text-xs text-muted-foreground">
					<span className="shrink-0">{t("canvas.picker.label")}</span>
					<select
						value={selectedPath ?? ""}
						onChange={(event) => setSelectedPath(event.target.value)}
						className="min-w-0 max-w-44 truncate rounded-md border-none bg-card px-1.5 py-1 text-xs text-foreground outline-none focus:outline-none"
					>
						{files.map((file) => (
							<option key={file} value={file}>
								{file.split("/").pop()}
							</option>
						))}
					</select>
				</label>
				<button
					type="button"
					onClick={() => void createDesign()}
					title={t("canvas.empty.create")}
					className="pointer-events-auto rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
				>
					＋
				</button>
				<button
					type="button"
					onClick={() => setShowPalette((value) => !value)}
					title={t("canvas.theme.title")}
					aria-pressed={showPalette}
					className={`pointer-events-auto rounded-md px-2 py-1 text-xs ${showPalette ? "text-primary" : "text-muted-foreground"} hover:bg-accent`}
				>
					◐
				</button>
				<button
					type="button"
					disabled={exporting || phase.kind !== "ready"}
					onClick={() => void runExport()}
					className="pointer-events-auto rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
				>
					{exporting ? t("canvas.export.running") : t("canvas.export")}
				</button>
			</div>

			<div className="relative min-h-0 flex-1">
				{phase.kind === "preparing" ? (
					<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
						<span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
						<p className="max-w-72 whitespace-pre-wrap text-xs text-muted-foreground">{progressText}</p>
						{phase.progress.phase === "installing" && phase.progress.outputTail ? (
							<pre className="max-h-24 max-w-full overflow-hidden text-ellipsis rounded-md bg-accent p-2 text-left text-[10px] text-muted-foreground">
								{phase.progress.outputTail}
							</pre>
						) : null}
					</div>
				) : null}
				{phase.kind === "error" ? (
					<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
						<span className="text-sm font-medium text-red-500">{t("engine.status.error")}</span>
						<pre className="max-h-40 max-w-full overflow-auto whitespace-pre-wrap rounded-md bg-accent p-2 text-left text-[10px] text-muted-foreground">
							{phase.message}
						</pre>
						<button
							type="button"
							onClick={() => setReloadNonce((value) => value + 1)}
							className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
						>
							{t("engine.status.retry")}
						</button>
					</div>
				) : null}
				{phase.kind === "ready" && session ? (
					<>
						<DesignCanvas session={session} port={phase.port} bridge={bridgeRef.current} />
						{showPalette ? <ThemePalette session={session} /> : null}
					</>
				) : null}
			</div>
		</div>
	);
}
