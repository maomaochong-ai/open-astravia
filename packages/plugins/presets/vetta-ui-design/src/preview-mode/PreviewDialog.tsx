import { useTranslation } from "@vetta-org/plugin-sdk";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { getPluginCtx, notify } from "../plugin-context";
import { frameUrl, pathOfFrame } from "../vetd/frame-url";
import type { VetdFrameEntry } from "../vetd/manifest-types";
import { usePreviewBridge } from "./preview-client";
import { PreviewToolbar } from "./PreviewToolbar";
import { clampToAvailable, MIN_VIEWPORT, type ViewportSize } from "./viewport";

interface PreviewDialogProps {
	port: number;
	frames: readonly VetdFrameEntry[];
	/** 打开时定位到哪一帧（画布上单独选中的那个，无选中则最左上）。 */
	initialFrameId: string;
	onClose(): void;
}

type ResizeEdge = "e" | "s" | "se";

interface ResizeState {
	pointerId: number;
	startX: number;
	startY: number;
	startWidth: number;
	startHeight: number;
	edge: ResizeEdge;
}

function sizeOfFrame(frames: readonly VetdFrameEntry[], frameId: string | null): ViewportSize | null {
	const frame = frames.find((entry) => entry.id === frameId);
	return frame ? { width: frame.width, height: frame.height } : null;
}

/**
 * 预览模式：把设计稿当成真实站点来点。
 *
 * 与画布上的 frame 的唯一区别就是不开元素选择——那边的点击语义是「选中这个元素」
 * 并且被 preventDefault 掉了，这里的点击就是点击。跨帧跳转由 frame 源码里的
 * `<Link to>` 完成，走的是引擎的真实路由，与系统浏览器里打开同一地址完全一致。
 */
export function PreviewDialog({ port, frames, initialFrameId, onClose }: PreviewDialogProps) {
	const { t } = useTranslation();
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const { nav, navigateTo, go, reload } = usePreviewBridge(iframeRef);
	/** iframe 的 src 只算一次：之后的换帧走客户端路由，重设 src 会整页重载。 */
	const initialUrlRef = useRef(frameUrl(port, initialFrameId));
	const [viewport, setViewport] = useState<ViewportSize>(() =>
		clampToAvailable(sizeOfFrame(frames, initialFrameId) ?? { width: 1024, height: 768 }),
	);
	const resizeRef = useRef<ResizeState | null>(null);

	// 首条 navigated 到达前（iframe 还在加载）先按打开时的目标显示，别让工具栏
	// 空着闪一下；之后一律以 iframe 报回来的为准——地址可能已经不在画框表里。
	const currentFrameId = nav ? nav.frameId : initialFrameId;
	const path = nav?.path ?? pathOfFrame(initialFrameId);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [onClose]);

	/** 回到「跟随画框」：当前这一帧的声明尺寸。 */
	const resetViewport = useCallback((): void => {
		const size = sizeOfFrame(frames, currentFrameId);
		if (size) setViewport(clampToAvailable(size));
	}, [frames, currentFrameId]);

	const openExternal = useCallback((): void => {
		void getPluginCtx()
			.ui.openExternal(`http://127.0.0.1:${port}${path}`)
			// dev server 的生命周期跟着画布走，链接不是永久的——先说清楚，别让用户
			// 稍后拿着一个打不开的地址来回试。
			.then(() => notify({ message: t("previewMode.openExternal.hint"), durationMs: 6000 }))
			.catch((error: unknown) => notify({ message: t("previewMode.openExternal.failed"), error }));
	}, [port, path, t]);

	const beginResize = (event: ReactPointerEvent, edge: ResizeEdge): void => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		resizeRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			startWidth: viewport.width,
			startHeight: viewport.height,
			edge,
		};
	};

	const moveResize = (event: ReactPointerEvent): void => {
		const state = resizeRef.current;
		if (!state || event.pointerId !== state.pointerId) return;
		// 按键早松开了却还在收到移动：那次 pointerup 落到了别处（指针飘进 iframe），
		// 就地收尾，别让视口继续跟着指针走。
		if (event.buttons === 0) {
			resizeRef.current = null;
			return;
		}
		const dx = event.clientX - state.startX;
		const dy = event.clientY - state.startY;
		setViewport({
			width:
				state.edge === "s"
					? state.startWidth
					: Math.max(MIN_VIEWPORT.width, Math.round(state.startWidth + dx)),
			height:
				state.edge === "e"
					? state.startHeight
					: Math.max(MIN_VIEWPORT.height, Math.round(state.startHeight + dy)),
		});
	};

	const endResize = (event: ReactPointerEvent): void => {
		if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null;
	};

	const handles: { edge: ResizeEdge; className: string }[] = [
		{ edge: "e", className: "-right-1 inset-y-0 w-2 cursor-ew-resize" },
		{ edge: "s", className: "-bottom-1 inset-x-0 h-2 cursor-ns-resize" },
		{ edge: "se", className: "-bottom-1 -right-1 size-3 cursor-nwse-resize" },
	];

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop
		<div
			className="fixed inset-0 z-50 flex overflow-auto bg-black/60 p-6"
			// 画布根节点在托手/空格态会 setPointerCapture 接管平移，指针事件漏下去
			// 会让画布跟着预览里的拖动一起跑。
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
			onClick={onClose}
			onContextMenu={(event) => event.preventDefault()}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: keeps backdrop clicks off the window */}
			<div
				className="m-auto flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
				style={{ width: viewport.width }}
				role="dialog"
				aria-label={t("previewMode.title")}
				onClick={(event) => event.stopPropagation()}
			>
				<PreviewToolbar
					frames={frames}
					currentFrameId={currentFrameId}
					path={path}
					canBack={nav?.canBack === true}
					canForward={nav?.canForward === true}
					viewport={viewport}
					onBack={() => go(-1)}
					onForward={() => go(1)}
					onReload={reload}
					onPickFrame={(frameId) => navigateTo(pathOfFrame(frameId))}
					onPickViewport={setViewport}
					onResetViewport={resetViewport}
					onOpenExternal={openExternal}
					onClose={onClose}
				/>
				<div className="relative bg-white" style={{ height: viewport.height }}>
					<iframe
						ref={iframeRef}
						title={t("previewMode.title")}
						src={initialUrlRef.current}
						className="h-full w-full border-0"
					/>
					{/* 拉伸手柄。压在 iframe 边缘之上，否则指针一进 iframe 事件就归它了。 */}
					{handles.map(({ edge, className }) => (
						// biome-ignore lint/a11y/noStaticElementInteractions: resize handle
						<div
							key={edge}
							className={`absolute z-10 ${className}`}
							onPointerDown={(event) => beginResize(event, edge)}
							onPointerMove={moveResize}
							onPointerUp={endResize}
							onPointerCancel={endResize}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
