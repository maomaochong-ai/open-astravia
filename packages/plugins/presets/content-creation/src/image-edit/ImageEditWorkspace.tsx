import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
	normalizeBounds,
	normalizePoint,
	type ContentImageEditPoint,
	type ContentImageEditRegion,
	type ContentImageEditRegionKind,
} from "./image-edit-document";

interface ImageEditWorkspaceProps {
	imageUrl: string;
	regions: readonly ContentImageEditRegion[];
	onApply: (regions: ContentImageEditRegion[]) => void;
	onClose: () => void;
}

type Tool = "select" | "rectangle" | "stroke" | "arrow" | "text";

const TOOL_ICONS: Record<Tool, string> = {
	select: "icon-[lucide--mouse-pointer-2]",
	rectangle: "icon-[lucide--square-dashed]",
	stroke: "icon-[lucide--pen-line]",
	arrow: "icon-[lucide--move-up-right]",
	text: "icon-[lucide--type]",
};

export function ImageEditWorkspace({ imageUrl, regions, onApply, onClose }: ImageEditWorkspaceProps) {
	const { t } = useTranslation();
	const [tool, setTool] = useState<Tool>("rectangle");
	const [draftRegions, setDraftRegions] = useState<ContentImageEditRegion[]>(() => [...regions]);
	const [history, setHistory] = useState<ContentImageEditRegion[][]>([]);
	const [future, setFuture] = useState<ContentImageEditRegion[][]>([]);
	const [active, setActive] = useState<{ kind: Tool; points: ContentImageEditPoint[] } | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const canvasRef = useRef<HTMLDivElement>(null);
	const imageRef = useRef<HTMLImageElement>(null);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	const updateRegions = (next: ContentImageEditRegion[]) => {
		setHistory((current) => [...current, draftRegions]);
		setFuture([]);
		setDraftRegions(next);
	};
	const pointFromEvent = (event: PointerEvent): ContentImageEditPoint | null => {
		const imageBounds = imageRef.current?.getBoundingClientRect();
		const bounds = imageBounds && imageBounds.width > 0 && imageBounds.height > 0
			? imageBounds
			: canvasRef.current?.getBoundingClientRect();
		if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
		return normalizePoint({
			x: (event.clientX - bounds.left) / bounds.width,
			y: (event.clientY - bounds.top) / bounds.height,
		});
	};
	const handlePointerDown = (event: PointerEvent) => {
		if (tool === "select") return;
		const point = pointFromEvent(event);
		if (!point) return;
		event.currentTarget.setPointerCapture?.(event.pointerId);
		setActive({ kind: tool, points: [point] });
	};
	const handlePointerMove = (event: PointerEvent) => {
		if (!active) return;
		const point = pointFromEvent(event);
		if (!point) return;
		setActive((current) => {
			if (!current) return current;
			const points = current.kind === "stroke" ? [...current.points, point] : [current.points[0]!, point];
			return { ...current, points };
		});
	};
	const handlePointerUp = () => {
		if (!active) return;
		const points = active.points;
		setActive(null);
		if (points.length < 2 && active.kind !== "text") return;
		const kind = active.kind as ContentImageEditRegionKind;
		const text = kind === "text" ? window.prompt(t("imageEdit.textPrompt"))?.trim() : undefined;
		if (kind === "text" && !text) return;
		const next: ContentImageEditRegion = {
			id: crypto.randomUUID(),
			kind,
			points,
			...(kind === "rectangle" ? { bounds: normalizeBounds(points[0]!, points[points.length - 1]!) } : {}),
			...(text ? { text, instruction: text } : {}),
		};
		updateRegions([...draftRegions, next]);
		setSelectedId(next.id);
	};
	const undo = () => {
		const previous = history.at(-1);
		if (!previous) return;
		setHistory((current) => current.slice(0, -1));
		setFuture((current) => [...current, draftRegions]);
		setDraftRegions(previous);
	};
	const redo = () => {
		const next = future.at(-1);
		if (!next) return;
		setFuture((current) => current.slice(0, -1));
		setHistory((current) => [...current, draftRegions]);
		setDraftRegions(next);
	};
	const selected = useMemo(() => draftRegions.find((region) => region.id === selectedId), [draftRegions, selectedId]);
	const removeSelected = () => {
		if (!selected) return;
		updateRegions(draftRegions.filter((region) => region.id !== selected.id));
		setSelectedId(null);
	};
	const updateSelectedInstruction = (instruction: string) => {
		if (!selected) return;
		setDraftRegions((current) => current.map((region) => (region.id === selected.id ? { ...region, instruction } : region)));
	};

	return (
		<div className="nodrag nopan relative h-full w-full overflow-hidden bg-neutral-950" role="group" aria-label={t("imageEdit.title")}>
			<div className="absolute inset-x-1 top-1 z-20 flex items-center justify-between rounded-md border border-white/15 bg-black/65 p-1 text-white backdrop-blur-sm">
				<div className="flex min-w-0 items-center gap-1">
					<span className="icon-[lucide--wand-sparkles] block size-3.5 shrink-0" aria-hidden="true" />
					<span className="truncate text-[10px] font-medium">{t("imageEdit.title")}</span>
				</div>
				<div className="flex items-center gap-0.5">
					{(Object.keys(TOOL_ICONS) as Tool[]).map((candidate) => (
						<Button key={candidate} type="button" size="icon-xs" variant={tool === candidate ? "secondary" : "ghost"} className="text-white hover:bg-white/15 hover:text-white" onClick={() => setTool(candidate)} title={t(`imageEdit.tool.${candidate}`)} aria-label={t(`imageEdit.tool.${candidate}`)}>
							<span className={`${TOOL_ICONS[candidate]} block size-4`} aria-hidden="true" />
						</Button>
					))}
					<span className="mx-1 h-4 w-px bg-white/20" />
					<Button type="button" size="icon-xs" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" disabled={history.length === 0} onClick={undo} title={t("imageEdit.undo")}><span className="icon-[lucide--undo-2] block size-4" aria-hidden="true" /></Button>
					<Button type="button" size="icon-xs" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" disabled={future.length === 0} onClick={redo} title={t("imageEdit.redo")}><span className="icon-[lucide--redo-2] block size-4" aria-hidden="true" /></Button>
					<Button type="button" size="icon-xs" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" disabled={!selected} onClick={removeSelected} title={t("imageEdit.remove")}><span className="icon-[lucide--trash-2] block size-4" aria-hidden="true" /></Button>
				</div>
			</div>
			<div data-testid="image-edit-canvas" ref={canvasRef} className="absolute inset-0 select-none" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
				<img ref={imageRef} src={imageUrl} alt="" className="block h-full w-full object-contain" draggable={false} />
				<svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
					<defs>
						<marker id="content-image-edit-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
							<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
						</marker>
					</defs>
					{draftRegions.map((region) => {
						const bounds = region.bounds;
						const points = region.points.map((point) => `${point.x},${point.y}`).join(" ");
						const isSelected = region.id === selectedId;
						if (region.kind === "rectangle" && bounds) return <rect key={region.id} x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} fill="rgb(239 68 68 / .18)" stroke={isSelected ? "white" : "rgb(248 113 113)"} strokeWidth=".004" onClick={(event) => { event.stopPropagation(); setSelectedId(region.id); }} />;
						if (region.kind === "text") return <text key={region.id} x={region.points[0]?.x ?? 0} y={region.points[0]?.y ?? 0} fill="white" fontSize=".035" stroke="black" strokeWidth=".002" paintOrder="stroke" onClick={(event) => { event.stopPropagation(); setSelectedId(region.id); }}>{region.text}</text>;
						return <polyline key={region.id} points={points} fill="none" stroke={isSelected ? "white" : "rgb(248 113 113)"} strokeWidth=".006" strokeLinecap="round" strokeLinejoin="round" markerEnd={region.kind === "arrow" ? "url(#content-image-edit-arrow)" : undefined} onClick={(event) => { event.stopPropagation(); setSelectedId(region.id); }} />;
					})}
					{active ? <polyline points={active.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="white" strokeWidth=".005" strokeDasharray=".012 .008" /> : null}
				</svg>
			</div>
			{selected ? (
				<label className="absolute inset-x-1 bottom-1 z-20 flex flex-col gap-1 rounded-md border border-white/15 bg-black/70 p-1.5 text-[10px] font-medium text-white backdrop-blur-sm">
					<span>{t("imageEdit.instruction")}</span>
					<textarea className="min-h-10 resize-y rounded border border-white/20 bg-black/30 px-2 py-1 text-xs text-white outline-none placeholder:text-white/60 focus-visible:border-white/60" value={selected.instruction ?? ""} placeholder={t("imageEdit.instructionPlaceholder")} onChange={(event) => updateSelectedInstruction(event.target.value)} />
				</label>
			) : null}
			<div className="absolute bottom-1 right-1 z-30 flex items-center gap-1">
				<Button type="button" size="sm" variant="ghost" className="h-7 bg-black/65 px-2 text-[10px] text-white hover:bg-black/80 hover:text-white" onClick={onClose}>{t("action.cancel")}</Button>
				<Button type="button" size="sm" className="h-7 px-2 text-[10px]" onClick={() => onApply(draftRegions)} disabled={draftRegions.length === 0}>{t("imageEdit.apply")}</Button>
			</div>
		</div>
	);
}
