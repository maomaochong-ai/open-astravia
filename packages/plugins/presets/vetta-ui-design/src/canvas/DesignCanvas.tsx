import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getPluginCtx, notify } from "../plugin-context";
import type { DesignSession } from "../vetd/design-session";
import type { VetdManifest } from "../vetd/manifest-types";
import { buildAskPrompt } from "./ask-vetta";
import { AskVettaPopover } from "./AskVettaPopover";
import { BridgeHub, type SelectedElementPayload } from "./bridge-client";
import { ControlBar, type CanvasTool } from "./ControlBar";
import { type FrameActivity, notifyFrameSettled, onFrameActivity } from "./design-runtime";
import { FrameView } from "./FrameView";

export type CanvasSelection =
	| { kind: "frame"; id: string }
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

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.2;

function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
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
	const [enteredFrameId, setEnteredFrameId] = useState<string | null>(null);
	const [activity, setActivity] = useState<ReadonlyMap<string, FrameActivity>>(new Map());
	const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
	const [askFrameId, setAskFrameId] = useState<string | null>(null);
	const [askBusy, setAskBusy] = useState(false);
	const panRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Viewport } | null>(null);
	const marqueeRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);

	useEffect(() => {
		const handle = session.on((change) => {
			if (change === "frames") setManifest({ ...session.manifest });
		});
		setManifest({ ...session.manifest });
		return () => handle.dispose();
	}, [session]);

	useEffect(() => onFrameActivity((next) => setActivity(new Map(next))), []);

	// Ask popover follows the selection: deselect / switch frame → close.
	useEffect(() => {
		if (!askFrameId) return;
		const selectedFrameId = selection ? (selection.kind === "frame" ? selection.id : selection.frameId) : null;
		if (selectedFrameId !== askFrameId) setAskFrameId(null);
	}, [selection, askFrameId]);

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
		setAskFrameId(null);
	}, [tool, bridge]);

	useEffect(() => {
		bridge.start({
			onSelected: (frameId, payload) => {
				setSelection(payload ? { kind: "dom", frameId, payload } : { kind: "frame", id: frameId });
			},
			onExitInspect: (frameId) => {
				exitInspect(frameId);
				setSelection({ kind: "frame", id: frameId });
			},
			onHmrUpdated: (frameId) => notifyFrameSettled(frameId),
		});
		return () => bridge.stop();
	}, [bridge, exitInspect]);

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
					setSelection({ kind: "frame", id: enteredFrameId });
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
		if (tool === "frame") {
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
			marqueeRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
			const world = toWorld(event.clientX, event.clientY);
			setMarquee({ x: world.x, y: world.y, width: 0, height: 0 });
			return;
		}
		// Select tool on empty canvas: clear selection / leave inspect.
		if (enteredFrameId) exitInspect(enteredFrameId);
		setSelection(null);
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
		if (marqueeRef.current && event.pointerId === marqueeRef.current.pointerId) {
			marqueeRef.current = null;
			const rect = marquee;
			setMarquee(null);
			setTool("select");
			if (rect && rect.width >= 40 && rect.height >= 40) {
				void session
					.createFrame(
						t("canvas.newFrame.defaultTitle"),
						Math.round(rect.width),
						Math.round(rect.height),
						Math.round(rect.x),
						Math.round(rect.y),
					)
					.then((id) => setSelection({ kind: "frame", id }));
			}
		}
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

	/** "让 Vetta 调整"：截图（DOM 选中时保留高亮）+ 元信息 + 用户建议 → sendPrompt。 */
	const sendAskToVetta = async (suggestion: string): Promise<void> => {
		if (!selection || askBusy) return;
		const frameId = selection.kind === "frame" ? selection.id : selection.frameId;
		setAskBusy(true);
		try {
			const ctx = getPluginCtx();
			const dataUrl = await bridge.capture(frameId, { keepHighlight: selection.kind === "dom" });
			const base64 = dataUrl.split(",")[1] ?? "";
			const screenshotPath = `${session.dirPath}/.snapshots/ask-${frameId}-${Date.now()}.png`;
			await ctx.fs.writeFile(screenshotPath, base64, "base64");
			await ctx.conversation.sendPrompt(buildAskPrompt(session, selection, screenshotPath, suggestion));
			notify({ message: t("canvas.ask.sent"), variant: "success", durationMs: 3000 });
			setAskFrameId(null);
		} catch (error) {
			notify({ message: t("canvas.ask.failed"), error });
		} finally {
			setAskBusy(false);
		}
	};

	/** Popover anchor: the frame's top-left corner in screen (container) space. */
	const askAnchor = useMemo(() => {
		if (!askFrameId) return null;
		const frame = manifest.frames.find((entry) => entry.id === askFrameId);
		if (!frame) return null;
		return {
			x: viewport.x + frame.x * viewport.zoom,
			y: viewport.y + frame.y * viewport.zoom + 8,
		};
	}, [askFrameId, manifest.frames, viewport]);

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
						selected={
							(selection?.kind === "frame" && selection.id === frame.id) ||
							(selection?.kind === "dom" && selection.frameId === frame.id)
						}
						entered={enteredFrameId === frame.id}
						interactive={tool === "select" && !panActive}
						activity={activity.get(frame.id)}
						onSelect={() => {
							if (enteredFrameId && enteredFrameId !== frame.id) exitInspect(enteredFrameId);
							setSelection({ kind: "frame", id: frame.id });
						}}
						onEnter={() => {
							if (enteredFrameId && enteredFrameId !== frame.id) exitInspect(enteredFrameId);
							setEnteredFrameId(frame.id);
							bridge.setMode(frame.id, "inspect");
						}}
						onAskVetta={() => setAskFrameId(frame.id)}
						onPlacementCommit={(patch) => session.updateFramePlacement(frame.id, patch)}
					/>
				))}
				{marquee ? (
					<div
						className="absolute border border-primary bg-primary/10"
						style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
					/>
				) : null}
			</div>

			{/* Pan shield: 托手工具或按住空格时，盖住所有 frame 接管拖动（Figma 行为），
			    frame 内起手也只平移、不选中。 */}
			{panActive ? <div className="absolute inset-0 z-10" style={{ cursor: "grab" }} /> : null}

			{askAnchor && selection ? (
				<AskVettaPopover
					x={askAnchor.x}
					y={askAnchor.y}
					busy={askBusy}
					onSend={(suggestion) => void sendAskToVetta(suggestion)}
					onClose={() => setAskFrameId(null)}
				/>
			) : null}

			<ControlBar
				tool={tool}
				zoom={viewport.zoom}
				onToolChange={setTool}
				onZoomDelta={zoomBy}
				onZoomReset={() => {
					const next = { ...viewportRef.current, zoom: 1 };
					setViewport(next);
					session.saveViewport(next);
				}}
			/>
		</div>
	);
}
