import { useActivityTab, useTranslation } from "@astravia-org/plugin-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type EngineProgress,
	startDesignServer,
	stopDesignServer,
} from "../engine/engine-manager";
import { exportDesign } from "../export/export-design";
import { NotesStore } from "../notes/notes-store";
import { useNotesVisibility } from "../notes/notes-visibility";
import { getPluginCtx, notify } from "../plugin-context";
import { PreviewDialog } from "../preview-mode/PreviewDialog";
import { DesignSession } from "../astd/design-session";
import { findAstdFiles } from "../astd/discover";
import { scaffoldDesign } from "../astd/scaffold";
import { BridgeHub, type ElementQuery, type SelectedElementPayload } from "./bridge-client";
import { refreshCover } from "./cover-compose";
import { clearFrameActivity, setCanvasController, setPendingDesignPath, takePendingDesignPath } from "./design-runtime";
import { DesignCanvas, type FrameCapture } from "./DesignCanvas";
import { byCanvasOrder } from "./frame-order";
import { ThemePalette } from "./ThemePalette";

type Phase =
	| { kind: "idle" }
	| { kind: "preparing"; progress: EngineProgress }
	| { kind: "ready"; port: number }
	| { kind: "error"; message: string };

/** 暂时隐藏顶栏「导出分享」入口（导入/导出链路本身保留）。 */
const SHOW_EXPORT_SHARE = false;

function storageKey(cwd: string): string {
	return `astravia-ui-design:file:${cwd}`;
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
	/** 画布备注气泡的显隐。开关在顶栏，自动规则（切工具/建备注/定位）只往显示推。 */
	const notesVisibility = useNotesVisibility();
	const [exporting, setExporting] = useState(false);
	const [reloadNonce, setReloadNonce] = useState(0);
	const bridgeRef = useRef(new BridgeHub());
	/** 画布挂载后填入，见 DesignCanvas 的 captureRef。 */
	const captureRef = useRef<FrameCapture | null>(null);
	/** 同上，问画布「此刻单独选中的是哪一帧」，预览按钮据此定位起始帧。 */
	const previewTargetRef = useRef<(() => string | null) | null>(null);
	/** 预览窗口打开在哪一帧上；null 表示没开。 */
	const [previewFrameId, setPreviewFrameId] = useState<string | null>(null);
	/** 同 captureRef：astd_notes 的锚点保鲜入口，画布挂载后填入。 */
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
		// 打包分享文件（后者是 `.astdz`，压根不会出现在这个列表里）。
		const found = await findAstdFiles(ctx.fs, cwd);
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
				openDesign: (astdPath) => {
					setPendingDesignPath(astdPath);
					void refreshFiles().then(() => setSelectedPath(astdPath));
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
			// 离开这份设计（切设计稿、关面板、切会话）时留一张画廊封面。
			// 放在拆卸时而不是每次截图后：位图落定是高频事件，而封面只要「最后那一版」。
			// dispose 之前抄一份 frames——dispose 之后 manifest 不再更新，但读没问题；
			// 这里先取值只是为了不依赖 dispose 的内部实现。
			const framesSnapshot = [...nextSession.manifest.frames];
			void refreshCover(nextSession.astdPath, framesSnapshot);
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
			notify({ message: t("create.done", { path: result.astdPath }), variant: "success", durationMs: 4000 });
			await refreshFiles();
			setSelectedPath(result.astdPath);
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
			// 用户在另存为对话框里取消：什么都没写盘，也不需要提示。
			if (path === null) return;
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
			case "installing-design":
				return t("engine.status.installingDesign");
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
				{/* 空态里没有工具栏，重扫入口只能放这儿：目录里明明有设计却扫不到时
				    （v1 旧格式刚被放进来、或上一次扫描时目录还没就绪），这是用户
				    唯一能自救的按钮，否则只剩「新建」这一条会让人以为设计丢了。 */}
				<button
					type="button"
					onClick={() => void refreshFiles()}
					className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
				>
					{t("canvas.empty.rescan")}
				</button>
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

	/**
	 * 画布左上角的标题区：设计切换（就是这张画布的标题，所以不套卡片底）+ 色卡开关。
	 * 定位交给画布（它要给查看模式的横幅让位），这里只管内容。
	 */
	const titleSlot = (
		<>
			<select
				value={selectedPath ?? ""}
				onChange={(event) => setSelectedPath(event.target.value)}
				title={t("canvas.picker.label")}
				aria-label={t("canvas.picker.label")}
				className="h-7 min-w-0 max-w-52 truncate rounded-md border-none bg-transparent px-1 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus:outline-none"
			>
				{files.map((file) => (
					<option key={file} value={file}>
						{file.split("/").pop()}
					</option>
				))}
			</select>
			<button
				type="button"
				onClick={() => setShowPalette((value) => !value)}
				title={t("canvas.theme.title")}
				aria-label={t("canvas.theme.title")}
				aria-pressed={showPalette}
				className={`flex size-7 shrink-0 items-center justify-center rounded-md text-xs transition-colors ${
					showPalette ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
				}`}
			>
				◐
			</button>
			{SHOW_EXPORT_SHARE ? (
				<button
					type="button"
					disabled={exporting || phase.kind !== "ready"}
					onClick={() => void runExport()}
					className="flex h-7 shrink-0 items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
				>
					{exporting ? t("canvas.export.running") : t("canvas.export")}
				</button>
			) : null}
		</>
	);

	return (
		<div className="relative flex h-full flex-col">
			<div className="relative min-h-0 flex-1">
				{/* 画布还没起来时也要能切设计：ready 之后这块由画布自己摆（它要给查看
				    模式的横幅让位），这里只补上引擎准备/失败期间的那段空窗。 */}
				{phase.kind !== "ready" ? (
					<div className="absolute left-3 top-3 z-40 flex items-center gap-1">{titleSlot}</div>
				) : null}
				{phase.kind === "preparing" ? (
					<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
						<span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
						<p className="max-w-72 whitespace-pre-wrap text-xs text-muted-foreground">{progressText}</p>
						{(phase.progress.phase === "installing" || phase.progress.phase === "installing-design") &&
						phase.progress.outputTail ? (
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
							onRescanDesigns={() => void refreshFiles()}
							previewTargetRef={previewTargetRef}
							previewing={previewFrameId !== null}
							resolveNoteElementsRef={resolveNoteElementsRef}
							notesVisible={notesVisibility.visible}
							showNotes={notesVisibility.show}
							onToggleNotes={notesVisibility.toggle}
							onRun={openPreview}
							runDisabled={session.manifest.frames.length === 0}
							titleSlot={titleSlot}
						/>
						{showPalette ? <ThemePalette session={session} /> : null}
						{previewFrameId !== null ? (
							<PreviewDialog
								port={phase.port}
								frames={session.manifest.frames}
								astdPath={session.astdPath}
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
