import { useTranslation } from "@vetta-org/plugin-sdk";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import type { VetdFrameEntry } from "../vetd/manifest-types";
import type { BridgeHub } from "./bridge-client";
import type { FrameActivity } from "./design-runtime";

type ResizeEdge = "nw" | "ne" | "sw" | "se" | "e" | "s";

interface FrameViewProps {
	frame: VetdFrameEntry;
	port: number;
	zoom: number;
	bridge: BridgeHub;
	selected: boolean;
	/** Inspect mode: pointer events pass through to the iframe. */
	entered: boolean;
	interactive: boolean;
	activity: FrameActivity | undefined;
	onSelect(): void;
	onEnter(): void;
	onAskVetta(): void;
	onPlacementCommit(patch: Partial<Pick<VetdFrameEntry, "x" | "y" | "width" | "height">>): void;
}

interface DragState {
	pointerId: number;
	startX: number;
	startY: number;
	origin: { x: number; y: number; width: number; height: number };
	edge: ResizeEdge | "move";
}

const MIN_WIDTH = 100;
const MIN_HEIGHT = 80;

export function FrameView({
	frame,
	port,
	zoom,
	bridge,
	selected,
	entered,
	interactive,
	activity,
	onSelect,
	onEnter,
	onAskVetta,
	onPlacementCommit,
}: FrameViewProps) {
	const { t } = useTranslation();
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const dragRef = useRef<DragState | null>(null);
	const [live, setLive] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

	useEffect(() => {
		bridge.register(frame.id, iframeRef.current);
		return () => bridge.register(frame.id, null);
	}, [bridge, frame.id]);

	const rect = live ?? { x: frame.x, y: frame.y, width: frame.width, height: frame.height };

	const beginDrag = (event: ReactPointerEvent, edge: DragState["edge"]): void => {
		if (!interactive || entered) return;
		event.preventDefault();
		event.stopPropagation();
		onSelect();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			origin: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
			edge,
		};
	};

	const moveDrag = (event: ReactPointerEvent): void => {
		const drag = dragRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		const dx = (event.clientX - drag.startX) / zoom;
		const dy = (event.clientY - drag.startY) / zoom;
		const { origin } = drag;
		if (drag.edge === "move") {
			setLive({ ...origin, x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) });
			return;
		}
		let { x, y, width, height } = origin;
		if (drag.edge.includes("e")) width = origin.width + dx;
		if (drag.edge.includes("s")) height = origin.height + dy;
		if (drag.edge.includes("w")) {
			width = origin.width - dx;
			x = origin.x + dx;
		}
		if (drag.edge === "nw" || drag.edge === "ne") {
			height = origin.height - dy;
			y = origin.y + dy;
		}
		if (width < MIN_WIDTH) {
			if (drag.edge.includes("w")) x -= MIN_WIDTH - width;
			width = MIN_WIDTH;
		}
		if (height < MIN_HEIGHT) {
			if (drag.edge === "nw" || drag.edge === "ne") y -= MIN_HEIGHT - height;
			height = MIN_HEIGHT;
		}
		setLive({
			x: Math.round(x),
			y: Math.round(y),
			width: Math.round(width),
			height: Math.round(height),
		});
	};

	const endDrag = (event: ReactPointerEvent): void => {
		const drag = dragRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		dragRef.current = null;
		if (live) {
			onPlacementCommit(live);
			setLive(null);
		}
	};

	const labelScale = Math.min(1 / zoom, 8);
	const handles: { edge: ResizeEdge; className: string }[] = [
		{ edge: "nw", className: "-left-1 -top-1 cursor-nwse-resize" },
		{ edge: "ne", className: "-right-1 -top-1 cursor-nesw-resize" },
		{ edge: "sw", className: "-bottom-1 -left-1 cursor-nesw-resize" },
		{ edge: "se", className: "-bottom-1 -right-1 cursor-nwse-resize" },
		{ edge: "e", className: "-right-1 top-1/2 -translate-y-1/2 cursor-ew-resize" },
		{ edge: "s", className: "-bottom-1 left-1/2 -translate-x-1/2 cursor-ns-resize" },
	];

	return (
		<div
			className="absolute"
			style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
			data-vetd-frame={frame.id}
		>
			{/* Title bar (inverse-scaled so it stays readable at any zoom). */}
			<div
				className="absolute left-0 flex items-center gap-1.5 whitespace-nowrap text-xs"
				style={{
					transform: `scale(${labelScale})`,
					transformOrigin: "left bottom",
					bottom: "100%",
					marginBottom: 4 * labelScale,
				}}
			>
				<button
					type="button"
					className={`cursor-pointer truncate font-medium ${selected ? "text-primary" : "text-muted-foreground"}`}
					onPointerDown={(event) => beginDrag(event, "move")}
					onPointerMove={moveDrag}
					onPointerUp={endDrag}
					onDoubleClick={onEnter}
				>
					{frame.title || frame.id}
				</button>
				<span className="text-muted-foreground">
					{rect.width}×{rect.height}
				</span>
				{selected ? (
					<button
						type="button"
						className="rounded-full bg-primary px-2 py-0.5 font-medium text-primary-foreground shadow-sm hover:opacity-90"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.stopPropagation();
							onAskVetta();
						}}
					>
						{t("canvas.ask.button")}
					</button>
				) : null}
				{activity === "modifying" ? (
					<span className="flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-primary">
						<span className="size-1.5 animate-pulse rounded-full bg-primary" />
						{t("canvas.frame.modifying")}
					</span>
				) : null}
				{activity === "updated" ? (
					<span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600">
						{t("canvas.frame.updated")}
					</span>
				) : null}
			</div>

			<div
				className={`relative h-full w-full overflow-hidden rounded-sm bg-white shadow-md ring-offset-0 ${
					selected ? "ring-2 ring-primary" : "ring-1 ring-border"
				} ${activity === "modifying" ? "vetd-modifying" : ""}`}
			>
				<iframe
					ref={iframeRef}
					title={frame.title || frame.id}
					src={`http://127.0.0.1:${port}/#/frame/${encodeURIComponent(frame.id)}`}
					className="h-full w-full border-0"
					style={{ pointerEvents: entered ? "auto" : "none" }}
				/>
				{/* Interaction shield: select/move at frame level until the user drills in. */}
				{!entered ? (
					// biome-ignore lint/a11y/noStaticElementInteractions: canvas manipulation surface
					<div
						className="absolute inset-0"
						style={{ cursor: interactive ? "default" : "inherit" }}
						onPointerDown={(event) => beginDrag(event, "move")}
						onPointerMove={moveDrag}
						onPointerUp={endDrag}
						onDoubleClick={(event) => {
							event.stopPropagation();
							if (interactive) onEnter();
						}}
					/>
				) : null}
			</div>

			{selected && !entered
				? handles.map(({ edge, className }) => (
						// biome-ignore lint/a11y/noStaticElementInteractions: resize handle
						<div
							key={edge}
							className={`absolute z-10 size-2 rounded-full border border-primary bg-white ${className}`}
							style={{ transform: `scale(${labelScale})` }}
							onPointerDown={(event) => beginDrag(event, edge)}
							onPointerMove={moveDrag}
							onPointerUp={endDrag}
						/>
					))
				: null}
		</div>
	);
}
