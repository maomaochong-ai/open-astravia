import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getPluginCtx } from "../plugin-context";
import type { DesignSession } from "../vetd/design-session";
import type { VetdManifest } from "../vetd/manifest-types";
import { domAttachment, frameAttachment } from "./attach";
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

	const exitInspect = useCallback(
		(frameId: string | null) => {
			if (frameId) bridge.setMode(frameId, "off");
			setEnteredFrameId(null);
		},
		[bridge],
	);

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

	const attachSelection = (): void => {
		const ctx = getPluginCtx();
		if (!selection) return;
		if (selection.kind === "frame") {
			const frame = manifest.frames.find((entry) => entry.id === selection.id);
			ctx.ui.setPromptAttachment(
				frameAttachment(session, selection.id, t("canvas.attach.frame", { name: frame?.title || selection.id })),
			);
		} else {
			ctx.ui.setPromptAttachment(
				domAttachment(
					session,
					selection.frameId,
					selection.payload,
					t("canvas.attach.dom", { frame: selection.frameId, tag: selection.payload.tag }),
				),
			);
		}
	};

	const selectionLabel = useMemo(() => {
		if (!selection) return null;
		if (selection.kind === "frame") {
			const frame = manifest.frames.find((entry) => entry.id === selection.id);
			return t("canvas.attach.frame", { name: frame?.title || selection.id });
		}
		return t("canvas.attach.dom", { frame: selection.frameId, tag: selection.payload.tag });
	}, [selection, manifest.frames, t]);

	const cursor = panActive ? "grab" : tool === "frame" ? "crosshair" : "default";

	return (
		<div
			ref={containerRef}
			className="relative h-full w-full overflow-hidden outline-none vetd-canvas-bg"
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
						onPlacementCommit={(patch) => session.updateFramePlacement(frame.id, patch)}
					/>
				))}
				{marquee ? (
					<div
						className="absolute border border-indigo-500 bg-indigo-500/10"
						style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
					/>
				) : null}
			</div>

			{/* Pan shield: while space is held, capture drags above every frame (Figma behavior). */}
			{spaceHeld && tool !== "hand" ? <div className="absolute inset-0 z-10" style={{ cursor: "grab" }} /> : null}

			{selection && selectionLabel ? (
				<div className="absolute bottom-16 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-black/10 bg-white/95 py-1.5 pl-3 pr-1.5 text-xs shadow-lg dark:border-white/10 dark:bg-neutral-900/95">
					<span className="max-w-72 truncate text-neutral-600 dark:text-neutral-300">{selectionLabel}</span>
					<button
						type="button"
						onClick={attachSelection}
						className="rounded-lg bg-indigo-500 px-2.5 py-1 font-medium text-white hover:bg-indigo-600"
					>
						{t("canvas.attach")}
					</button>
				</div>
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
