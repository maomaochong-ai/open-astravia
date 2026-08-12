import { useTranslation } from "@vetta-org/plugin-sdk";
import { cn } from "@vetta/ui";
import { useMemo } from "react";
import {
	CONTENT_NODE_DEFINITIONS,
	type ContentNodeCategory,
	type ContentNodeDefinition,
} from "../node/definitions";
import type { ContentNodeKind } from "../project/types";
import { NodeKindIcon } from "../node/NodeKindIcon";

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
