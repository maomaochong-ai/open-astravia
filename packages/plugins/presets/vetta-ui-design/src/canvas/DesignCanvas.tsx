import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { getPluginCtx, notify } from "../plugin-context";
import type { DesignSession } from "../vetd/design-session";
import type { VetdFrameEntry, VetdManifest } from "../vetd/manifest-types";
import { type AskShot, buildAskPrompt } from "./ask-vetta";
import { AskVettaButton } from "./AskVettaButton";
import { AskVettaPopover } from "./AskVettaPopover";
import { BridgeHub, type SelectedElementPayload } from "./bridge-client";
import { ControlBar, type CanvasTool } from "./ControlBar";
import {
	type FrameActivity,
	notifyFrameSettled,
	onFrameActivity,
	requestMockupExport,
} from "./design-runtime";
import { useFrameRasters } from "./frame-raster";
import { FrameView } from "./FrameView";

export type CanvasSelection =
	| { kind: "frames"; ids: string[] }
	| { kind: "dom"; frameId: string; payload: SelectedElementPayload }
	| null;

interface DesignCanvasProps {
	session: DesignSession;
	port: number;
	bridge: BridgeHub;
}

interface Viewport {
	x: number;
	y: number;
	zoom: number;
}

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.2;
/** Below this the marquee counts as a click, not a drag. */
const MARQUEE_MIN = 4;

function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Frames the current selection covers — a DOM selection counts as its frame. */
function selectedFrameIds(selection: CanvasSelection): string[] {
	if (!selection) return [];
	return selection.kind === "frames" ? selection.ids : [selection.frameId];
}

function intersects(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Canvas reading order: left to right, top to bottom for equal x. */
function byCanvasOrder(a: VetdFrameEntry, b: VetdFrameEntry): number {
	return a.x === b.x ? a.y - b.y : a.x - b.x;
}

export function DesignCanvas({ session, port, bridge }: DesignCanvasProps) {
	const { t } = useTranslation();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [manifest, setManifest] = useState<VetdManifest>(session.manifest);
	const [viewport, setViewport] = useState<Viewport>(() => ({ ...session.manifest.canvas }));
	const viewportRef = useRef(viewport);
	viewportRef.current = viewport;
	const [tool, setTool] = useState<CanvasTool>("select");
	const [spaceHeld, setSpaceHeld] = useState(false);
	const [selection, setSelection] = useState<CanvasSelection>(null);
	const selectionRef = useRef(selection);
	selectionRef.current = selection;
	const [enteredFrameId, setEnteredFrameId] = useState<string | null>(null);
	const [activity, setActivity] = useState<ReadonlyMap<string, FrameActivity>>(new Map());
	const [marquee, setMarquee] = useState<Rect | null>(null);
	/** 默认开：这是排查用的降级开关，不改既有观感。 */
	const [effectsEnabled, setEffectsEnabled] = useState(true);
	const effectsRef = useRef(effectsEnabled);
	effectsRef.current = effectsEnabled;
	const [askOpen, setAskOpen] = useState(false);
	const [askBusy, setAskBusy] = useState(false);
	const [moveDelta, setMoveDelta] = useState<{ dx: number; dy: number } | null>(null);
	const panRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Viewport } | null>(null);
	const marqueeRef = useRef<{ pointerId: number; startX: number; startY: number; mode: "create" | "select" } | null>(
		null,
	);
	const moveRef = useRef<{ origins: Map<string, { x: number; y: number }> } | null>(null);
	/** 平移进行中的实时视口。非 null 时 DOM 上的 transform 由它驱动，state 落后一步。 */
	const panLiveRef = useRef<Viewport | null>(null);
	const rafRef = useRef<number | null>(null);
	const wheelSettleRef = useRef<number | null>(null);
	const worldRef = useRef<HTMLDivElement | null>(null);

	const paintViewport = useCallback((next: Viewport): void => {
		const world = worldRef.current;
		if (world) world.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
	}, []);

	/** 把高频 pointermove 折叠到每帧一次实际绘制。 */
	const schedulePaint = useCallback((): void => {
		if (rafRef.current !== null) return;
		rafRef.current = window.requestAnimationFrame(() => {
			rafRef.current = null;
			if (panLiveRef.current) paintViewport(panLiveRef.current);
		});
	}, [paintViewport]);

	// 平移途中若因别的原因（manifest 变化、活动态更新）触发了渲染，React 会用落后
	// 的 state 覆盖 transform 把画布弹回去；这里在提交后、绘制前再抹一次实时值。
	useLayoutEffect(() => {
		if (panLiveRef.current) paintViewport(panLiveRef.current);
	});

	useEffect(
		() => () => {
			if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
		},
		[],
	);

	useEffect(() => {
		const handle = session.on((change) => {
			if (change === "frames") setManifest({ ...session.manifest });
		});
		setManifest({ ...session.manifest });
		return () => handle.dispose();
	}, [session]);

	useEffect(() => onFrameActivity((next) => setActivity(new Map(next))), []);

	// 空闲 frame 用位图代替活体 iframe，画布上就不再有 N 套渲染树同时合成。
	const {
		rasterOf,
		isLive,
		invalidate: invalidateRaster,
		runLive,
		stats: rasterStats,
	} = useFrameRasters({ bridge, enteredFrameId, enabled: true });

	const exitInspect = useCallback(
		(frameId: string | null) => {
			if (frameId) bridge.setMode(frameId, "off");
			setEnteredFrameId(null);
		},
		[bridge],
	);

	// 切到托手工具：清空选中（含 DOM 选中态），托手期间不产生任何选中。
	useEffect(() => {
		if (tool !== "hand") return;
		setEnteredFrameId((entered) => {
			if (entered) bridge.setMode(entered, "off");
			return null;
		});
		setSelection(null);
	}, [tool, bridge]);

	useEffect(() => {
		bridge.start({
			onSelected: (frameId, payload) => {
				setSelection(payload ? { kind: "dom", frameId, payload } : { kind: "frames", ids: [frameId] });
			},
			onExitInspect: (frameId) => {
				exitInspect(frameId);
				setSelection({ kind: "frames", ids: [frameId] });
			},
			onHmrUpdated: (frameId) => {
				notifyFrameSettled(frameId);
				if (frameId) invalidateRaster(frameId);
			},
			onRendered: invalidateRaster,
		});
		return () => bridge.stop();
	}, [bridge, exitInspect, invalidateRaster]);

	/** Click / shift-click a frame. Shift toggles membership; a plain click replaces. */
	const selectFrame = useCallback((frameId: string, additive: boolean): void => {
		setSelection((current) => {
			if (!additive) return { kind: "frames", ids: [frameId] };
			const base = current ? (current.kind === "frames" ? current.ids : [current.frameId]) : [];
			if (!base.includes(frameId)) return { kind: "frames", ids: [...base, frameId] };
			const next = base.filter((id) => id !== frameId);
			return next.length > 0 ? { kind: "frames", ids: next } : null;
		});
	}, []);

	// Space → temporary hand tool; Esc at canvas level clears selection.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.code === "Space" && !event.repeat) {
				event.preventDefault();
				setSpaceHeld(true);
			} else if (event.key === "Escape") {
				if (enteredFrameId) {
					exitInspect(enteredFrameId);
					setSelection({ kind: "frames", ids: [enteredFrameId] });
				} else {
					setSelection(null);
				}
			}
		};
		const onKeyUp = (event: KeyboardEvent): void => {
			if (event.code === "Space") setSpaceHeld(false);
		};
		container.addEventListener("keydown", onKeyDown);
		container.addEventListener("keyup", onKeyUp);
		return () => {
			container.removeEventListener("keydown", onKeyDown);
			container.removeEventListener("keyup", onKeyUp);
		};
	}, [enteredFrameId, exitInspect]);

	// Ctrl/⌘ + wheel → stepless zoom around the cursor; plain wheel → pan.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const onWheel = (event: WheelEvent): void => {
			event.preventDefault();
			const bounds = container.getBoundingClientRect();
			const current = viewportRef.current;
			if (event.ctrlKey || event.metaKey) {
				const cursorX = event.clientX - bounds.left;
				const cursorY = event.clientY - bounds.top;
				const nextZoom = clampZoom(current.zoom * Math.exp(-event.deltaY * 0.01));
				const scale = nextZoom / current.zoom;
				const next = {
					zoom: nextZoom,
					x: cursorX - (cursorX - current.x) * scale,
					y: cursorY - (cursorY - current.y) * scale,
				};
				// 缩放要重渲染（frame 标题与手柄按 zoom 反向缩放），走 state。
				// 先撤掉可能还挂着的滚轮平移实时值，否则 layout effect 会拿旧位置盖回去。
				panLiveRef.current = null;
				if (wheelSettleRef.current !== null) {
					window.clearTimeout(wheelSettleRef.current);
					wheelSettleRef.current = null;
				}
				setViewport(next);
				session.saveViewport(next);
			} else {
				// 滚轮平移与托手拖拽同理：走 DOM，不逐事件进 state（触控板两指平移
				// 同样高频）。停下来一小会儿再落 state 与磁盘。
				const next = { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY };
				viewportRef.current = next;
				panLiveRef.current = next;
				schedulePaint();
				if (wheelSettleRef.current !== null) window.clearTimeout(wheelSettleRef.current);
				wheelSettleRef.current = window.setTimeout(() => {
					wheelSettleRef.current = null;
					const settled = panLiveRef.current;
					if (!settled || panRef.current) return;
					panLiveRef.current = null;
					setViewport(settled);
					session.saveViewport(settled);
				}, 140);
			}
		};
		container.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			container.removeEventListener("wheel", onWheel);
			if (wheelSettleRef.current !== null) window.clearTimeout(wheelSettleRef.current);
		};
	}, [session, schedulePaint]);

	const toWorld = useCallback((clientX: number, clientY: number) => {
		const bounds = containerRef.current?.getBoundingClientRect();
		const current = viewportRef.current;
		const localX = clientX - (bounds?.left ?? 0);
		const localY = clientY - (bounds?.top ?? 0);
		return { x: (localX - current.x) / current.zoom, y: (localY - current.y) / current.zoom };
	}, []);

	const panActive = tool === "hand" || spaceHeld;

	const onBackgroundPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
		containerRef.current?.focus();
		if (panActive) {
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
			panRef.current = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				origin: viewportRef.current,
			};
			return;
		}
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		marqueeRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			mode: tool === "frame" ? "create" : "select",
		};
		const world = toWorld(event.clientX, event.clientY);
		setMarquee({ x: world.x, y: world.y, width: 0, height: 0 });
		// Select tool on empty canvas: drop the current selection unless extending it.
		if (tool !== "frame" && !event.shiftKey) {
			if (enteredFrameId) exitInspect(enteredFrameId);
			setSelection(null);
		}
	};

	const onBackgroundPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
		const pan = panRef.current;
		if (pan && event.pointerId === pan.pointerId) {
			const next = {
				...pan.origin,
				x: pan.origin.x + (event.clientX - pan.startX),
				y: pan.origin.y + (event.clientY - pan.startY),
			};
			// 平移只改外层那一个 transform，不进 state：过 React 的话每个 pointermove
			// 都要重渲染整棵 frame 子树（每个 frame 一个跨源 iframe），指针事件又是
			// 高频且会合并投递，于是渲染把合成器饿死，整窗口高频闪烁。
			viewportRef.current = next;
			panLiveRef.current = next;
			schedulePaint();
			return;
		}
		const mq = marqueeRef.current;
		if (mq && event.pointerId === mq.pointerId) {
			const start = toWorld(mq.startX, mq.startY);
			const now = toWorld(event.clientX, event.clientY);
			setMarquee({
				x: Math.min(start.x, now.x),
				y: Math.min(start.y, now.y),
				width: Math.abs(now.x - start.x),
				height: Math.abs(now.y - start.y),
			});
		}
	};

	const onBackgroundPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (panRef.current && event.pointerId === panRef.current.pointerId) {
			panRef.current = null;
			if (rafRef.current !== null) {
				window.cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			// 松手才把这一趟平移交回 state：期间 DOM 已经是最终位置，这次渲染不会跳。
			const settled = panLiveRef.current ?? viewportRef.current;
			panLiveRef.current = null;
			setViewport(settled);
			session.saveViewport(settled);
			return;
		}
		const mq = marqueeRef.current;
		if (!mq || event.pointerId !== mq.pointerId) return;
		marqueeRef.current = null;
		const rect = marquee;
		setMarquee(null);
		if (!rect) return;

		if (mq.mode === "create") {
			setTool("select");
			if (rect.width >= 40 && rect.height >= 40) {
				void session
					.createFrame(
						t("canvas.newFrame.defaultTitle"),
						Math.round(rect.width),
						Math.round(rect.height),
						Math.round(rect.x),
						Math.round(rect.y),
					)
					.then((id) => setSelection({ kind: "frames", ids: [id] }));
			}
			return;
		}

		if (rect.width < MARQUEE_MIN && rect.height < MARQUEE_MIN) return;
		const hits = manifest.frames.filter((frame) => intersects(rect, frame)).map((frame) => frame.id);
		if (hits.length === 0) return;
		setSelection((current) => {
			const base = event.shiftKey && current ? selectedFrameIds(current) : [];
			const ids = [...new Set([...base, ...hits])];
			return { kind: "frames", ids };
		});
	};

	const zoomBy = (direction: 1 | -1): void => {
		const container = containerRef.current;
		const bounds = container?.getBoundingClientRect();
		const centerX = (bounds?.width ?? 0) / 2;
		const centerY = (bounds?.height ?? 0) / 2;
		const current = viewportRef.current;
		const nextZoom = clampZoom(direction === 1 ? current.zoom * ZOOM_STEP : current.zoom / ZOOM_STEP);
		const scale = nextZoom / current.zoom;
		const next = {
			zoom: nextZoom,
			x: centerX - (centerX - current.x) * scale,
			y: centerY - (centerY - current.y) * scale,
		};
		setViewport(next);
		session.saveViewport(next);
	};

	/** Grab the placement of every frame that will travel with this drag. */
	const beginMove = (frameId: string, additive: boolean): void => {
		const already = selectedFrameIds(selectionRef.current);
		let ids: string[];
		if (additive) {
			selectFrame(frameId, true);
			ids = already.includes(frameId) ? already.filter((id) => id !== frameId) : [...already, frameId];
		} else if (already.includes(frameId)) {
			// Dragging a member of the current selection moves the whole group.
			ids = already;
		} else {
			setSelection({ kind: "frames", ids: [frameId] });
			ids = [frameId];
		}
		const origins = new Map<string, { x: number; y: number }>();
		for (const id of ids) {
			const frame = manifest.frames.find((entry) => entry.id === id);
			if (frame) origins.set(id, { x: frame.x, y: frame.y });
		}
		moveRef.current = { origins };
	};

	const commitMove = (): void => {
		const state = moveRef.current;
		const delta = moveDelta;
		moveRef.current = null;
		setMoveDelta(null);
		if (!state || !delta || (delta.dx === 0 && delta.dy === 0)) return;
		for (const [id, origin] of state.origins) {
			void session.updateFramePlacement(id, { x: origin.x + delta.dx, y: origin.y + delta.dy });
		}
	};

	/**
	 * 降级开关关着时截图会丢掉毛玻璃，无论是发给 agent 还是导出成品都不该失真。
	 * 截这一张之前临时恢复，截完再关回去。
	 */
	const captureFaithfully = useCallback(
		async (frameId: string, options?: { keepHighlight?: boolean; pixelRatio?: number }): Promise<string> => {
			const degraded = !effectsRef.current;
			if (degraded) bridge.setEffectsEnabled(true);
			try {
				// 位图态的 frame 是 display:none，没有布局也就截不出东西，先拉回活体。
				return await runLive(frameId, () => bridge.capture(frameId, { ...options, timeoutMs: 30_000 }));
			} finally {
				if (degraded) bridge.setEffectsEnabled(false);
			}
		},
		[bridge, runLive],
	);

	const selectedIds = selectedFrameIds(selection);
	/** Export / ask act on canvas order, not on click order. */
	const orderedSelection = manifest.frames.filter((frame) => selectedIds.includes(frame.id)).sort(byCanvasOrder);

	/** "让 Vetta 调整"：N 张截图（DOM 选中时保留高亮）+ 元信息 + 用户建议 → sendPrompt。 */
	const sendAskToVetta = (suggestion: string): void => {
		if (askBusy) return;
		// 关掉浮层是「已交出去」的反馈，不等截图落盘、更不等 Vetta 跑完：
		// sendPrompt 复用会话的完整发送链路，要整轮结束才 resolve。
		setAskOpen(false);
		setAskBusy(true);
		void (async () => {
			try {
				const ctx = getPluginCtx();
				const domFrameId = selection?.kind === "dom" ? selection.frameId : null;
				const shots: AskShot[] = [];
				for (const frame of orderedSelection) {
					const dataUrl = await captureFaithfully(frame.id, { keepHighlight: frame.id === domFrameId });
					const base64 = dataUrl.split(",")[1] ?? "";
					const screenshotPath = `${session.dirPath}/.snapshots/ask-${frame.id}-${Date.now()}.png`;
					await ctx.fs.writeFile(screenshotPath, base64, "base64");
					shots.push({ frameId: frame.id, screenshotPath });
				}
				const dom = selection?.kind === "dom" ? { frameId: selection.frameId, payload: selection.payload } : null;
				const prompt = buildAskPrompt(session, { shots, dom }, suggestion);
				void ctx.conversation.sendPrompt(prompt).catch((error: unknown) => {
					notify({ message: t("canvas.ask.failed"), error });
				});
				notify({ message: t("canvas.ask.sent"), variant: "success", durationMs: 3000 });
			} catch (error) {
				notify({ message: t("canvas.ask.failed"), error });
			} finally {
				setAskBusy(false);
			}
		})();
	};

	const openExport = (): void => {
		if (orderedSelection.length === 0) return;
		requestMockupExport({
			session,
			frameIds: orderedSelection.map((frame) => frame.id),
			capture: (frameId, pixelRatio) => captureFaithfully(frameId, { pixelRatio }),
		});
	};

	const cursor = panActive ? "grab" : tool === "frame" ? "crosshair" : "default";

	return (
		<div
			ref={containerRef}
			// select-none：画布外壳（frame 标题、尺寸标注等）不参与文本选择，
			// 否则拖动平移会把它们刷成蓝色高亮，看着像选中了 frame。
			className="relative h-full w-full select-none overflow-hidden outline-none vetd-canvas-bg"
			style={{ cursor }}
			tabIndex={-1}
			role="application"
			onPointerDown={onBackgroundPointerDown}
			onPointerMove={onBackgroundPointerMove}
			onPointerUp={onBackgroundPointerUp}
		>
			<div
				ref={worldRef}
				className="absolute left-0 top-0"
				style={{
					transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
					transformOrigin: "0 0",
					// 刻意不加 will-change / translateZ：这一层的包围盒覆盖所有 frame，
					// 动辄上万像素，强行提升成合成层会超出 GPU 纹理上限，合成器降级后
					// 整窗口撕裂闪烁。让浏览器自己决定要不要提升。
				}}
			>
				{manifest.frames.map((frame) => (
					<FrameView
						key={frame.id}
						frame={frame}
						port={port}
						zoom={viewport.zoom}
						bridge={bridge}
						selected={selectedIds.includes(frame.id)}
						entered={enteredFrameId === frame.id}
						interactive={tool === "select" && !panActive}
						resizable={selectedIds.length === 1}
						live={isLive(frame.id)}
						raster={rasterOf(frame.id)}
						moveDelta={moveRef.current?.origins.has(frame.id) ? moveDelta : null}
						activity={activity.get(frame.id)}
						onSelect={(additive) => {
							if (enteredFrameId && enteredFrameId !== frame.id) exitInspect(enteredFrameId);
							selectFrame(frame.id, additive);
						}}
						onEnter={() => {
							if (enteredFrameId && enteredFrameId !== frame.id) exitInspect(enteredFrameId);
							setSelection({ kind: "frames", ids: [frame.id] });
							setEnteredFrameId(frame.id);
							bridge.setMode(frame.id, "inspect");
						}}
						onMoveStart={(additive) => {
							if (enteredFrameId && enteredFrameId !== frame.id) exitInspect(enteredFrameId);
							beginMove(frame.id, additive);
						}}
						onMoveDelta={(dx, dy) => setMoveDelta({ dx, dy })}
						onMoveEnd={commitMove}
						onResizeCommit={(patch) => session.updateFramePlacement(frame.id, patch)}
					/>
				))}
				{marquee ? (
					<div
						className="absolute border border-[var(--vetd-selected)] vetd-marquee-fill"
						style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
					/>
				) : null}
			</div>

			{/* Pan shield: 托手工具或按住空格时，盖住所有 frame 接管拖动（Figma 行为），
			    frame 内起手也只平移、不选中。 */}
			{panActive ? <div className="absolute inset-0 z-10" style={{ cursor: "grab" }} /> : null}

			{askOpen ? (
				<AskVettaPopover
					busy={askBusy}
					onSend={sendAskToVetta}
					onClose={() => setAskOpen(false)}
				/>
			) : null}

			{!panActive ? (
				<AskVettaButton
					selectedCount={orderedSelection.length}
					elementMode={selection?.kind === "dom"}
					active={askOpen}
					onClick={() => setAskOpen((open) => !open)}
				/>
			) : null}

			<ControlBar
				tool={tool}
				zoom={viewport.zoom}
				exportableCount={orderedSelection.length}
				effectsEnabled={effectsEnabled}
				raster={{ ...rasterStats, total: manifest.frames.length }}
				onToggleEffects={() => {
					const next = !effectsEnabled;
					setEffectsEnabled(next);
					bridge.setEffectsEnabled(next);
				}}
				onToolChange={setTool}
				onZoomDelta={zoomBy}
				onZoomReset={() => {
					const next = { ...viewportRef.current, zoom: 1 };
					setViewport(next);
					session.saveViewport(next);
				}}
				onExport={openExport}
			/>
		</div>
	);
}
