import { useTranslation } from "@vetta-org/plugin-sdk";
import { cn } from "@vetta/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	CONTENT_NODE_DEFINITIONS,
	type ContentNodeCategory,
	type ContentNodeDefinition,
} from "../node/definitions";
import type { ContentNodeKind } from "../project/types";
import { NodeKindIcon } from "../node/NodeKindIcon";
import type { CanvasTool } from "./canvas-tools";

const CATEGORY_ORDER: ContentNodeCategory[] = ["input", "generation", "resource", "output"];
/** Create-first order for empty canvas; dock still reuses the same set. */
const QUICK_CREATE_KINDS: readonly ContentNodeKind[] = [
	"image-generator",
	"video-generator",
	"prompt",
	"asset",
];

/** Menu density chips only — empty starter uses bare icons. */
const NODE_ICON_CHIP_CLASS = "bg-muted/80 text-muted-foreground";

interface NodeDefinitionGridProps {
	definitions: readonly ContentNodeDefinition[];
	onSelect: (kind: ContentNodeKind) => void;
	showCategories?: boolean;
	compact?: boolean;
}

export function NodeDefinitionGrid({
	definitions,
	onSelect,
	showCategories = true,
	compact = false,
}: NodeDefinitionGridProps) {
	const { t } = useTranslation();

	if (definitions.length === 0) {
		return <p className="m-0 text-xs leading-normal text-muted-foreground">{t("nodeLibrary.empty")}</p>;
	}

	if (!showCategories) {
		return (
			<div className="mt-4 grid grid-cols-4 gap-1.5 max-[900px]:grid-cols-2">
				{definitions.map((definition) => (
					<NodeDefinitionButton key={definition.kind} definition={definition} onSelect={onSelect} compact={compact} />
				))}
			</div>
		);
	}

	return (
		<div className="mt-2.5 flex max-h-[360px] flex-col gap-3 overflow-y-auto">
			{CATEGORY_ORDER.map((category) => {
				const categoryDefinitions = definitions.filter((definition) => definition.category === category);
				if (categoryDefinitions.length === 0) return null;
				return (
					<section key={category}>
						<h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
							{t(`node.category.${category}`)}
						</h4>
						<div className="grid grid-cols-2 gap-1.5">
							{categoryDefinitions.map((definition) => (
								<NodeDefinitionButton
									key={definition.kind}
									definition={definition}
									onSelect={onSelect}
									compact={compact}
								/>
							))}
						</div>
					</section>
				);
			})}
		</div>
	);
}

function NodeDefinitionButton({
	definition,
	onSelect,
	compact,
}: {
	definition: ContentNodeDefinition;
	onSelect: (kind: ContentNodeKind) => void;
	compact: boolean;
}) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			className={cn(
				"grid min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-card/70 text-left text-foreground transition-colors",
				"hover:border-primary/40 hover:bg-primary/5",
				compact ? "grid-cols-[30px_minmax(0,1fr)] p-1.5" : "grid-cols-[34px_minmax(0,1fr)] px-2.5 py-2",
			)}
			onClick={() => onSelect(definition.kind)}
		>
			<span
				className={cn(
					"grid shrink-0 place-items-center rounded-lg",
					NODE_ICON_CHIP_CLASS,
					compact ? "size-[30px]" : "size-[34px]",
				)}
			>
				<NodeKindIcon kind={definition.kind} className="size-4" />
			</span>
			<span className="flex min-w-0 flex-col gap-0.5">
				<strong className="truncate text-[11px] font-medium">{t(`node.kind.${definition.kind}`)}</strong>
				<span className={cn("text-[10px] leading-snug text-muted-foreground", compact && "hidden")}>
					{t(definition.descriptionKey)}
				</span>
			</span>
		</button>
	);
}

interface EmptyCanvasStarterProps {
	onAdd: (kind: ContentNodeKind) => void;
}

/**
 * First-run empty canvas — open header over a single glass choice surface.
 * Avoids nested card-in-card chrome and per-kind icon chips (reads denser / cheaper).
 */
export function EmptyCanvasStarter({ onAdd }: EmptyCanvasStarterProps) {
	const { t } = useTranslation();
	const byKind = useMemo(
		() => new Map(CONTENT_NODE_DEFINITIONS.map((definition) => [definition.kind, definition])),
		[],
	);
	const quickDefinitions = QUICK_CREATE_KINDS.flatMap((kind) => {
		const definition = byKind.get(kind);
		return definition ? [definition] : [];
	});

	return (
		<section
			className={cn(
				"pointer-events-auto absolute top-1/2 left-1/2 z-[5]",
				"w-[min(392px,calc(100%_-_48px))] -translate-x-1/2 -translate-y-1/2",
			)}
		>
			<header className="mb-5 text-center">
				<h2 className="m-0 text-[15px] font-medium tracking-[-0.01em] text-foreground">
					{t("graph.empty.title")}
				</h2>
				<p className="mx-auto mb-0 mt-1.5 max-w-[18rem] text-[12px] leading-relaxed text-muted-foreground/80">
					{t("graph.empty.description")}
				</p>
			</header>

			<div
				className={cn(
					"rounded-[22px] border border-border/40 bg-popover/55 p-1.5",
					"shadow-[0_28px_80px_-28px_rgba(0,0,0,0.55)] backdrop-blur-2xl",
					"ring-1 ring-black/[0.03] dark:bg-popover/40 dark:ring-white/[0.05]",
				)}
			>
				<div className="grid grid-cols-2 gap-0.5">
					{quickDefinitions.map((definition) => (
						<button
							key={definition.kind}
							type="button"
							className={cn(
								"group flex min-h-[104px] flex-col items-start justify-between gap-5 rounded-[16px] px-3.5 py-3.5 text-left",
								"transition-[background-color,transform,color] duration-150",
								"hover:bg-foreground/[0.045] active:scale-[0.99]",
								"focus-visible:bg-foreground/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
							)}
							onClick={() => onAdd(definition.kind)}
						>
							<NodeKindIcon
								kind={definition.kind}
								className="size-[18px] text-muted-foreground/70 transition-colors duration-150 group-hover:text-foreground"
							/>
							<span className="flex min-w-0 flex-col gap-1">
								<strong className="text-[13px] font-medium tracking-[-0.01em] text-foreground">
									{t(`node.kind.${definition.kind}`)}
								</strong>
								<span className="text-[11px] leading-snug text-muted-foreground/70">
									{t(`graph.empty.hint.${definition.kind}`)}
								</span>
							</span>
						</button>
					))}
				</div>
			</div>
		</section>
	);
}

interface CanvasCreateMenuProps {
	left: number;
	top: number;
	onSelect: (kind: ContentNodeKind) => void;
}

export function CanvasCreateMenu({ left, top, onSelect }: CanvasCreateMenuProps) {
	const { t } = useTranslation();
	return (
		<div
			className="absolute z-20 w-[min(320px,calc(100vw_-_48px))] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg nodrag nowheel"
			style={{ left, top }}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<div className="mb-2.5 flex flex-col gap-0.5 text-[13px]">
				<strong className="font-medium">{t("nodeLibrary.createTitle")}</strong>
			</div>
			<NodeDefinitionGrid definitions={CONTENT_NODE_DEFINITIONS} onSelect={onSelect} compact />
		</div>
	);
}

interface NodeLibraryProps {
	activeTool: CanvasTool;
	onAdd: (kind: ContentNodeKind) => void;
	onToolChange: (tool: CanvasTool) => void;
}

/** Mac Dock–style magnification: subtle peak so hover stays readable without dizziness. */
const DOCK_ICON = 34;
const DOCK_MAX_SCALE = 1.18;
const DOCK_INFLUENCE = 56;
const DOCK_GAP = 6;
const DOCK_DIVIDER_WIDTH = 1;

type DockItem =
	| { type: "tool"; tool: CanvasTool; key: string }
	| { type: "node"; kind: ContentNodeKind; key: string }
	| { type: "divider"; key: string }
	| { type: "more"; key: string };

function dockMagnifyScale(distancePx: number): number {
	if (distancePx >= DOCK_INFLUENCE) return 1;
	const t = distancePx / DOCK_INFLUENCE;
	// Cosine bump — near-cursor peaks, neighbors ease out (classic dock feel).
	return 1 + (DOCK_MAX_SCALE - 1) * Math.cos((t * Math.PI) / 2) ** 2;
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

export function NodeLibrary({ activeTool, onAdd, onToolChange }: NodeLibraryProps) {
	const { t } = useTranslation();
	const rootRef = useRef<HTMLDivElement>(null);
	const dockRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [mouseX, setMouseX] = useState<number | null>(null);
	const reducedMotion = usePrefersReducedMotion();
	const quickDefinitions = CONTENT_NODE_DEFINITIONS.filter((definition) =>
		QUICK_CREATE_KINDS.includes(definition.kind),
	);

	const dockItems = useMemo<DockItem[]>(() => {
		const items: DockItem[] = [
			{ type: "tool", tool: "select", key: "tool-select" },
			{ type: "tool", tool: "pan", key: "tool-pan" },
			{ type: "divider", key: "divider-tools" },
		];
		items.push(...quickDefinitions.map((definition) => ({
			type: "node",
			kind: definition.kind,
			key: definition.kind,
		}) satisfies DockItem));
		items.push({ type: "divider", key: "divider-nodes" });
		items.push({ type: "more", key: "more" });
		return items;
	}, [quickDefinitions]);

	/** Slot centers in dock-local X using unscaled layout (avoids transform feedback). */
	const slotCenters = useMemo(() => {
		const centers: number[] = [];
		let x = 8; // horizontal padding of the dock chrome
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
			if (dockItems[index]?.type === "divider") return;
			if (scale > bestScale) {
				bestScale = scale;
				best = index;
			}
		});
		return bestScale > 1.04 ? best : -1;
	}, [dockItems, mouseX, scales]);

	const peakLabel =
		peakIndex >= 0
			? (() => {
					const item = dockItems[peakIndex];
					if (!item) return null;
					if (item.type === "tool") return t(`canvas.tool.${item.tool}`);
					if (item.type === "node") return t(`node.kind.${item.kind}`);
					if (item.type === "more") return t("nodeLibrary.title");
					return null;
				})()
			: null;

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
			{/*
			 * Magnify via transform only: slot size stays DOCK_ICON so the bar chrome
			 * does not grow; icons overflow upward past the dock (origin bottom).
			 */}
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
						if (!bounds) return;
						setMouseX(event.clientX - bounds.left);
					}}
					onPointerLeave={() => setMouseX(null)}
				>
					{dockItems.map((item, index) => {
						if (item.type === "divider") {
							return (
								<span
									key={item.key}
									className="w-px shrink-0 self-center bg-border"
									style={{ height: DOCK_ICON * 0.55 }}
									aria-hidden
								/>
							);
						}

						const scale = scales[index] ?? 1;
						const label =
							item.type === "tool"
								? t(`canvas.tool.${item.tool}`)
								: item.type === "node"
									? t(`node.kind.${item.kind}`)
									: t("nodeLibrary.title");
						const activeToolButton = item.type === "tool" && item.tool === activeTool;
						const activeMore = item.type === "more" && open;

						return (
							<button
								key={item.key}
								type="button"
								title={label}
								aria-label={label}
								aria-pressed={item.type === "tool" ? activeToolButton : undefined}
								aria-expanded={item.type === "more" ? open : undefined}
								className={cn(
									"relative z-[1] flex shrink-0 items-center justify-center rounded-[22%] border border-transparent text-foreground outline-none",
									"origin-bottom will-change-transform",
									"focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
									activeToolButton || activeMore
										? "bg-primary/12 text-primary"
										: "bg-muted/55 text-foreground hover:bg-muted",
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
									} else if (item.type === "node") onAdd(item.kind);
									else setOpen((value) => !value);
								}}
							>
								<span className="grid size-4 place-items-center leading-none [&>*]:h-full [&>*]:w-full">
									{item.type === "tool" ? (
										item.tool === "select" ? (
											<span
												className="icon-[lucide--mouse-pointer-2] block h-full w-full"
												aria-hidden="true"
											/>
										) : (
											<span className="icon-[lucide--hand] block h-full w-full" aria-hidden="true" />
										)
									) : item.type === "node" ? (
										<NodeKindIcon kind={item.kind} className="h-full w-full" />
									) : (
										<span className="icon-[lucide--plus] block h-full w-full" aria-hidden="true" />
									)}
								</span>
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}
