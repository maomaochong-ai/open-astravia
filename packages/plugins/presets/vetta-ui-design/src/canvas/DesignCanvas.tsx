import { useTranslation } from "@vetta-org/plugin-sdk";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
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
	const [askOpen, setAskOpen] = useState(false);
	const [askBusy, setAskBusy] = useState(false);
	const [moveDelta, setMoveDelta] = useState<{ dx: number; dy: number } | null>(null);
	const panRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Viewport } | null>(null);
	const marqueeRef = useRef<{ pointerId: number; startX: number; startY: number; mode: "create" | "select" } | null>(
		null,
	);
	const moveRef = useRef<{ origins: Map<string, { x: number; y: number }> } | null>(null);

	useEffect(() => {
		const handle = session.on((change) => {
			if (change === "frames") setManifest({ ...session.manifest });
		});
		setManifest({ ...session.manifest });
		return () => handle.dispose();
	}, [session]);

	useEffect(() => onFrameActivity((next) => setActivity(new Map(next))), []);

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
			onHmrUpdated: (frameId) => notifyFrameSettled(frameId),
		});
		return () => bridge.stop();
	}, [bridge, exitInspect]);

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
				setViewport(next);
				session.saveViewport(next);
			} else {
				const next = { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY };
				setViewport(next);
				session.saveViewport(next);
			}
		};
		container.addEventListener("wheel", onWheel, { passive: false });
		return () => container.removeEventListener("wheel", onWheel);
	}, [session]);

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
			setViewport(next);
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
			session.saveViewport(viewportRef.current);
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
					const dataUrl = await bridge.capture(frame.id, { keepHighlight: frame.id === domFrameId });
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
			capture: (frameId, pixelRatio) => bridge.capture(frameId, { pixelRatio, timeoutMs: 30_000 }),
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
				className="absolute left-0 top-0"
				style={{
					transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
					transformOrigin: "0 0",
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
