import { useActivityTab, useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type EngineProgress,
	startDesignServer,
	stopDesignServer,
} from "../engine/engine-manager";
import { exportDesign } from "../export/export-design";
import { NotesStore } from "../notes/notes-store";
import { getPluginCtx, notify } from "../plugin-context";
import { PreviewDialog } from "../preview-mode/PreviewDialog";
import { DesignSession } from "../vetd/design-session";
import { findVetdFiles } from "../vetd/discover";
import { scaffoldDesign } from "../vetd/scaffold";
import { BridgeHub, type ElementQuery, type SelectedElementPayload } from "./bridge-client";
import { DOCK_GAP, DOCK_ICON } from "./dock-magnify";
import { clearFrameActivity, setCanvasController, setPendingDesignPath, takePendingDesignPath } from "./design-runtime";
import { byCanvasOrder, DesignCanvas, type FrameCapture } from "./DesignCanvas";
import { ThemePalette } from "./ThemePalette";

type Phase =
	| { kind: "idle" }
	| { kind: "preparing"; progress: EngineProgress }
	| { kind: "ready"; port: number }
	| { kind: "error"; message: string };

/** 暂时隐藏顶栏「导出分享」入口（导入/导出链路本身保留）。 */
const SHOW_EXPORT_SHARE = false;

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
	const [notesStore, setNotesStore] = useState<NotesStore | null>(null);
	const [showPalette, setShowPalette] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [reloadNonce, setReloadNonce] = useState(0);
	const bridgeRef = useRef(new BridgeHub());
	/** 画布挂载后填入，见 DesignCanvas 的 captureRef。 */
	const captureRef = useRef<FrameCapture | null>(null);
	/** 同上，供顶部刷新按钮强制所有 frame 重载并重截位图。 */
	const refreshRef = useRef<(() => void) | null>(null);
	/** 同上，问画布「此刻单独选中的是哪一帧」，预览按钮据此定位起始帧。 */
	const previewTargetRef = useRef<(() => string | null) | null>(null);
	/** 预览窗口打开在哪一帧上；null 表示没开。 */
	const [previewFrameId, setPreviewFrameId] = useState<string | null>(null);
	/** 同 captureRef：vetd_notes 的锚点保鲜入口，画布挂载后填入。 */
	const resolveNoteElementsRef = useRef<
		((frameId: string, queries: ElementQuery[]) => Promise<(SelectedElementPayload | null)[]>) | null
	>(null);

	// 画布很吃宽度：每次激活本标签卡（切走会卸载，故每次都触发）把活动面板拉满，
	// 用户之后仍可自行拖窄。
	useEffect(() => {
		getPluginCtx().ui.setActivityPanelWidth("max");
	}, []);

	const refreshFiles = useCallback(async (): Promise<string[]> => {
		if (!cwd) {
			setFiles([]);
			return [];
		}
		const ctx = getPluginCtx();
		// 设计包是目录，认的是里面的 design.json——不再需要按内容嗅探区分工作态与
		// 打包分享文件（后者是 `.vetdz`，压根不会出现在这个列表里）。
		const found = await findVetdFiles(ctx.fs, cwd);
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
			setNotesStore(null);
			setPhase({ kind: "idle" });
			return;
		}
		localStorage.setItem(storageKey(cwd), selectedPath);
		const ctx = getPluginCtx();
		const nextSession = new DesignSession(ctx, selectedPath);
		const nextNotes = new NotesStore(ctx.fs, nextSession.dirPath);
		let cancelled = false;
		setPhase({ kind: "preparing", progress: { phase: "checking" } });
		setSession(nextSession);
		setNotesStore(nextNotes);
		void nextNotes.load();
		void (async () => {
			await nextSession.open();
			const server = await startDesignServer(ctx, nextSession.dirPath, (progress) => {
				if (!cancelled) setPhase({ kind: "preparing", progress });
			});
			if (cancelled) return;
			setCanvasController({
				session: nextSession,
				notes: nextNotes,
				port: server.port,
				captureFrame: (frameId) => {
					const capture = captureRef.current;
					// 画布还没挂上（引擎刚就绪那一瞬），直接说清楚，别让工具卡到超时。
					if (!capture) return Promise.reject(new Error("design canvas is not rendered yet"));
					return capture(frameId);
				},
				resolveNoteElements: (frameId, queries) => {
					const resolve = resolveNoteElementsRef.current;
					if (!resolve) return Promise.reject(new Error("design canvas is not rendered yet"));
					return resolve(frameId, queries);
				},
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
			nextNotes.dispose();
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

	/** 选中哪帧就从哪帧开始预览；没选中则从画布顺序里的第一帧开始。 */
	const openPreview = (): void => {
		if (!session) return;
		const selected = previewTargetRef.current?.() ?? null;
		const first = [...session.manifest.frames].sort(byCanvasOrder)[0]?.id ?? null;
		const target = selected ?? first;
		if (target) setPreviewFrameId(target);
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
			{/* 沉浸式标题栏：浮在画布之上，底色由主题变量渐隐到透明。
			    按钮组顶部居中，样式与底部 ControlBar 的 dock 对齐。 */}
			<div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center bg-gradient-to-b from-background via-background/80 to-transparent px-3 pb-6 pt-2">
				<div
					className="pointer-events-auto flex items-center rounded-2xl border border-border/80 bg-popover/90 px-2 py-1.5 shadow-md backdrop-blur-md"
					style={{ gap: DOCK_GAP }}
				>
					<select
						value={selectedPath ?? ""}
						onChange={(event) => setSelectedPath(event.target.value)}
						title={t("canvas.picker.label")}
						aria-label={t("canvas.picker.label")}
						className="min-w-0 max-w-44 truncate rounded-[10px] border-none bg-muted/55 px-2 text-xs text-foreground outline-none hover:bg-muted focus:outline-none"
						style={{ height: DOCK_ICON }}
					>
						{files.map((file) => (
							<option key={file} value={file}>
								{file.split("/").pop()}
							</option>
						))}
					</select>
					<span className="w-px shrink-0 self-center bg-border" style={{ height: DOCK_ICON * 0.55 }} aria-hidden />
					<button
						type="button"
						onClick={() => setShowPalette((value) => !value)}
						title={t("canvas.theme.title")}
						aria-label={t("canvas.theme.title")}
						aria-pressed={showPalette}
						className={`flex shrink-0 items-center justify-center rounded-[10px] text-xs ${
							showPalette ? "bg-primary/12 text-primary" : "bg-muted/55 text-foreground hover:bg-muted"
						}`}
						style={{ width: DOCK_ICON, height: DOCK_ICON }}
					>
						◐
					</button>
					{/* 手动刷新：热更新链路（文件监听 / HMR）万一没生效时的兜底出路，
					    强制所有 frame 重新加载最新代码并重截位图。 */}
					<button
						type="button"
						disabled={phase.kind !== "ready"}
						onClick={() => refreshRef.current?.()}
						title={t("canvas.refresh")}
						aria-label={t("canvas.refresh")}
						className="flex shrink-0 items-center justify-center rounded-[10px] bg-muted/55 text-foreground hover:bg-muted disabled:opacity-50"
						style={{ width: DOCK_ICON, height: DOCK_ICON }}
					>
						<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
							<path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</button>
					{SHOW_EXPORT_SHARE ? (
						<button
							type="button"
							disabled={exporting || phase.kind !== "ready"}
							onClick={() => void runExport()}
							className="flex shrink-0 items-center rounded-[10px] bg-muted/55 px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
							style={{ height: DOCK_ICON }}
						>
							{exporting ? t("canvas.export.running") : t("canvas.export")}
						</button>
					) : null}
					<span className="w-px shrink-0 self-center bg-border" style={{ height: DOCK_ICON * 0.55 }} aria-hidden />
					{/* 运行：把设计稿当成真实站点来点。带文字，它是这组里唯一一个「进入
					    另一种模式」的动作，纯 icon 认不出来。 */}
					<button
						type="button"
						disabled={phase.kind !== "ready" || (session?.manifest.frames.length ?? 0) === 0}
						onClick={openPreview}
						title={t("canvas.run")}
						className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
						style={{ height: DOCK_ICON }}
					>
						<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
							<path d="M6 4l12 8-12 8V4z" strokeLinejoin="round" />
						</svg>
						{t("canvas.run")}
					</button>
				</div>
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
				{phase.kind === "ready" && session && notesStore ? (
					<>
						<DesignCanvas
							session={session}
							notes={notesStore}
							cwd={cwd}
							port={phase.port}
							bridge={bridgeRef.current}
							captureRef={captureRef}
							refreshRef={refreshRef}
							previewTargetRef={previewTargetRef}
							previewing={previewFrameId !== null}
							resolveNoteElementsRef={resolveNoteElementsRef}
						/>
						{showPalette ? <ThemePalette session={session} /> : null}
						{previewFrameId !== null ? (
							<PreviewDialog
								port={phase.port}
								frames={session.manifest.frames}
								initialFrameId={previewFrameId}
								onClose={() => setPreviewFrameId(null)}
							/>
						) : null}
					</>
				) : null}
			</div>
		</div>
	);
}
