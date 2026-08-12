import { useTranslation } from "@vetta-org/plugin-sdk";
import { cn } from "@vetta/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { CONTENT_NODE_DEFINITIONS } from "../node/definitions";
import { NodeKindIcon } from "../node/NodeKindIcon";
import type { ContentNodeKind } from "../project/types";
import { NodeDefinitionGrid } from "./NodeLibrary";
import type { CanvasTool } from "./canvas-tools";

const QUICK_CREATE_KINDS: readonly ContentNodeKind[] = ["image-generator", "video-generator", "prompt", "asset"];
const DOCK_ICON = 34;
const DOCK_MAX_SCALE = 1.18;
const DOCK_INFLUENCE = 56;
const DOCK_GAP = 6;
const DOCK_DIVIDER_WIDTH = 1;

type DockItem =
	| { type: "tool"; tool: CanvasTool; key: string }
	| { type: "history"; action: "undo" | "redo"; key: string }
	| { type: "node"; kind: ContentNodeKind; key: string }
	| { type: "divider"; key: string }
	| { type: "more"; key: string };

interface CanvasDockProps {
	activeTool: CanvasTool;
	canUndo: boolean;
	canRedo: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onAdd: (kind: ContentNodeKind) => void;
	onToolChange: (tool: CanvasTool) => void;
}

export function CanvasDock({
	activeTool,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	onAdd,
	onToolChange,
}: CanvasDockProps) {
	const { t } = useTranslation();
	const rootRef = useRef<HTMLDivElement>(null);
	const dockRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [mouseX, setMouseX] = useState<number | null>(null);
	const reducedMotion = usePrefersReducedMotion();
	const quickDefinitions = useMemo(
		() => CONTENT_NODE_DEFINITIONS.filter((definition) => QUICK_CREATE_KINDS.includes(definition.kind)),
		[],
	);
	const dockItems = useMemo<DockItem[]>(() => {
		const items: DockItem[] = [
			{ type: "tool", tool: "select", key: "tool-select" },
			{ type: "tool", tool: "pan", key: "tool-pan" },
			{ type: "divider", key: "divider-tools" },
			{ type: "history", action: "undo", key: "history-undo" },
			{ type: "history", action: "redo", key: "history-redo" },
			{ type: "divider", key: "divider-history" },
		];
		items.push(
			...quickDefinitions.map(
				(definition) => ({ type: "node", kind: definition.kind, key: definition.kind }) satisfies DockItem,
			),
		);
		items.push({ type: "divider", key: "divider-nodes" }, { type: "more", key: "more" });
		return items;
	}, [quickDefinitions]);
	const slotCenters = useMemo(() => {
		const centers: number[] = [];
		let x = 8;
		for (const [index, item] of dockItems.entries()) {
			const width = item.type === "divider" ? DOCK_DIVIDER_WIDTH : DOCK_ICON;
			centers.push(x + width / 2);
			x += width;
			if (index < dockItems.length - 1) x += DOCK_GAP;
		}
		return centers;
	}, [dockItems]);
	const scales = useMemo(() => {
		if (reducedMotion || mouseX === null) return dockItems.map(() => 1);
		return slotCenters.map((center, index) =>
			dockItems[index]?.type === "divider" ? 1 : dockMagnifyScale(Math.abs(mouseX - center)),
		);
	}, [dockItems, mouseX, reducedMotion, slotCenters]);

	useEffect(() => {
		if (!open) return;
		const close = (event: PointerEvent) => {
			if (event.target instanceof globalThis.Node && rootRef.current?.contains(event.target)) return;
			setOpen(false);
		};
		document.addEventListener("pointerdown", close, true);
		return () => document.removeEventListener("pointerdown", close, true);
	}, [open]);

	const peakIndex = useMemo(() => {
		if (mouseX === null) return -1;
		let best = -1;
		let bestScale = 1;
		scales.forEach((scale, index) => {
			if (dockItems[index]?.type !== "divider" && scale > bestScale) {
				bestScale = scale;
				best = index;
			}
		});
		return bestScale > 1.04 ? best : -1;
	}, [dockItems, mouseX, scales]);
	const peakLabel = peakIndex >= 0 ? dockItemLabel(dockItems[peakIndex], t) : null;

	return (
		<div ref={rootRef} className="pointer-events-auto absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
			{open ? (
				<div className="absolute bottom-[calc(100%_+_14px)] left-1/2 z-20 w-[min(320px,calc(100vw_-_48px))] -translate-x-1/2 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg">
					<div className="mb-2.5 flex flex-col gap-0.5 text-[13px]">
						<strong className="font-medium">{t("nodeLibrary.createTitle")}</strong>
					</div>
					<NodeDefinitionGrid
						definitions={CONTENT_NODE_DEFINITIONS}
						compact
						onSelect={(kind) => {
							onAdd(kind);
							setOpen(false);
						}}
					/>
				</div>
			) : null}
			<div className="relative inline-flex flex-col items-center overflow-visible pt-10">
				{peakLabel && peakIndex >= 0 ? (
					<div
						className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-border/70 bg-popover/95 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-popover-foreground shadow-sm"
						style={{ left: slotCenters[peakIndex] }}
					>
						{peakLabel}
					</div>
				) : null}
				<div
					ref={dockRef}
					className="inline-flex items-end overflow-visible rounded-2xl border border-border/80 bg-popover/90 px-2 py-1.5 shadow-md backdrop-blur-md"
					style={{ gap: DOCK_GAP, height: DOCK_ICON + 12 }}
					onPointerMove={(event) => {
						if (reducedMotion) return;
						const bounds = dockRef.current?.getBoundingClientRect();
						if (bounds) setMouseX(event.clientX - bounds.left);
					}}
					onPointerLeave={() => setMouseX(null)}
				>
					{dockItems.map((item, index) => {
						if (item.type === "divider") {
							return <span key={item.key} className="w-px shrink-0 self-center bg-border" style={{ height: DOCK_ICON * 0.55 }} aria-hidden />;
						}
						const label = dockItemLabel(item, t) ?? "";
						const disabled = item.type === "history" && (item.action === "undo" ? !canUndo : !canRedo);
						const active =
							(item.type === "tool" && item.tool === activeTool) || (item.type === "more" && open);
						const scale = scales[index] ?? 1;
						return (
							<button
								key={item.key}
								type="button"
								title={label}
								aria-label={label}
								aria-pressed={item.type === "tool" ? active : undefined}
								aria-expanded={item.type === "more" ? open : undefined}
								disabled={disabled}
								className={cn(
									"relative z-[1] flex shrink-0 origin-bottom items-center justify-center rounded-[22%] border border-transparent text-foreground outline-none will-change-transform",
									"focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
									active ? "bg-primary/12 text-primary" : "bg-muted/55 text-foreground hover:bg-muted",
									disabled && "cursor-not-allowed opacity-35 hover:bg-muted/55",
									scale > 1.02 && "z-[2]",
								)}
								style={{
									width: DOCK_ICON,
									height: DOCK_ICON,
									transform: `scale(${scale})`,
									transition: reducedMotion
										? "transform 120ms ease"
										: "transform 140ms cubic-bezier(0.25, 0.8, 0.25, 1), background-color 120ms ease",
								}}
								onClick={() => {
									if (item.type === "tool") {
										onToolChange(item.tool);
										setOpen(false);
									} else if (item.type === "history") {
										if (item.action === "undo") onUndo();
										else onRedo();
									} else if (item.type === "node") onAdd(item.kind);
									else setOpen((value) => !value);
								}}
							>
								<DockItemIcon item={item} />
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}

function DockItemIcon({ item }: { item: Exclude<DockItem, { type: "divider" }> }) {
	if (item.type === "tool") {
		return <span className={`${item.tool === "select" ? "icon-[lucide--mouse-pointer-2]" : "icon-[lucide--hand]"} block size-4`} aria-hidden="true" />;
	}
	if (item.type === "history") {
		return <span className={`${item.action === "undo" ? "icon-[lucide--undo-2]" : "icon-[lucide--redo-2]"} block size-4`} aria-hidden="true" />;
	}
	if (item.type === "node") return <NodeKindIcon kind={item.kind} className="size-4" />;
	return <span className="icon-[lucide--plus] block size-4" aria-hidden="true" />;
}

function dockItemLabel(
	item: DockItem | undefined,
	t: (key: string) => string,
): string | null {
	if (!item || item.type === "divider") return null;
	if (item.type === "tool") return t(`canvas.tool.${item.tool}`);
	if (item.type === "history") return t(`action.${item.action}`);
	if (item.type === "node") return t(`node.kind.${item.kind}`);
	return t("nodeLibrary.title");
}

function dockMagnifyScale(distancePx: number): number {
	if (distancePx >= DOCK_INFLUENCE) return 1;
	const distance = distancePx / DOCK_INFLUENCE;
	return 1 + (DOCK_MAX_SCALE - 1) * Math.cos((distance * Math.PI) / 2) ** 2;
}

function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(false);
	useEffect(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		const sync = () => setReduced(media.matches);
		sync();
		media.addEventListener("change", sync);
		return () => media.removeEventListener("change", sync);
	}, []);
	return reduced;
}
