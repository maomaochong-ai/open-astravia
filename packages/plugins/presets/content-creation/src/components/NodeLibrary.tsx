import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useRef, useState } from "react";
import {
	CONTENT_NODE_DEFINITIONS,
	type ContentNodeCategory,
	type ContentNodeDefinition,
} from "../domain/node-definitions";
import type { ContentNodeKind } from "../domain/model";
import { AddIcon } from "./icons";
import { NodeKindIcon } from "./NodeKindIcon";

const CATEGORY_ORDER: ContentNodeCategory[] = ["input", "generation", "resource", "output"];
const QUICK_CREATE_KINDS: readonly ContentNodeKind[] = ["prompt", "image-generator", "video-generator"];

interface NodeDefinitionGridProps {
	definitions: readonly ContentNodeDefinition[];
	onSelect: (kind: ContentNodeKind) => void;
	showCategories?: boolean;
}

export function NodeDefinitionGrid({ definitions, onSelect, showCategories = true }: NodeDefinitionGridProps) {
	const { t } = useTranslation();

	if (definitions.length === 0) {
		return <p className="text-xs text-muted-foreground">{t("nodeLibrary.empty")}</p>;
	}

	if (!showCategories) {
		return (
			<div className="grid grid-cols-3 gap-2">
				{definitions.map((definition) => (
					<NodeDefinitionButton key={definition.kind} definition={definition} onSelect={onSelect} />
				))}
			</div>
		);
	}

	return (
		<div className="max-h-[360px] space-y-3 overflow-y-auto p-3">
			{CATEGORY_ORDER.map((category) => {
				const categoryDefinitions = definitions.filter((definition) => definition.category === category);
				if (categoryDefinitions.length === 0) return null;
				return (
					<section key={category} className="space-y-1.5">
						<h4 className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t(`node.category.${category}`)}</h4>
						<div className="grid grid-cols-2 gap-1.5">
							{categoryDefinitions.map((definition) => (
								<NodeDefinitionButton key={definition.kind} definition={definition} onSelect={onSelect} />
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
}: {
	definition: ContentNodeDefinition;
	onSelect: (kind: ContentNodeKind) => void;
}) {
	const { t } = useTranslation();
	return (
		<button type="button" className="flex min-w-0 items-start gap-2 rounded-md border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-accent/60" onClick={() => onSelect(definition.kind)}>
			<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
				<NodeKindIcon kind={definition.kind} />
			</span>
			<span className="min-w-0">
				<strong className="block truncate text-xs font-medium">{t(`node.kind.${definition.kind}`)}</strong>
				<span className="mt-0.5 block line-clamp-2 text-[10px] text-muted-foreground">{t(definition.descriptionKey)}</span>
			</span>
		</button>
	);
}

interface EmptyCanvasStarterProps {
	onAdd: (kind: ContentNodeKind) => void;
}

export function EmptyCanvasStarter({ onAdd }: EmptyCanvasStarterProps) {
	const { t } = useTranslation();
	const quickDefinitions = CONTENT_NODE_DEFINITIONS.filter((definition) => QUICK_CREATE_KINDS.includes(definition.kind));
	return (
		<section className="mx-auto flex max-w-xl flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-card/60 p-8 text-center">
			<h2 className="text-base font-semibold">{t("graph.empty.title")}</h2>
			<p className="text-sm text-muted-foreground">{t("graph.empty.description")}</p>
			<NodeDefinitionGrid definitions={quickDefinitions} onSelect={onAdd} showCategories={false} />
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
			className="absolute z-50 w-[320px] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl nodrag nowheel"
			style={{ left, top }}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<div className="border-b border-border/60 px-3 py-2 text-sm font-semibold">
				<strong>{t("nodeLibrary.createTitle")}</strong>
			</div>
			<NodeDefinitionGrid definitions={CONTENT_NODE_DEFINITIONS} onSelect={onSelect} />
		</div>
	);
}

interface NodeLibraryProps {
	onAdd: (kind: ContentNodeKind) => void;
}

export function NodeLibrary({ onAdd }: NodeLibraryProps) {
	const { t } = useTranslation();
	const rootRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const quickDefinitions = CONTENT_NODE_DEFINITIONS.filter((definition) => QUICK_CREATE_KINDS.includes(definition.kind));

	useEffect(() => {
		if (!open) return;
		const close = (event: PointerEvent) => {
			if (event.target instanceof globalThis.Node && rootRef.current?.contains(event.target)) return;
			setOpen(false);
		};
		document.addEventListener("pointerdown", close, true);
		return () => document.removeEventListener("pointerdown", close, true);
	}, [open]);

	return (
		<div ref={rootRef} className="absolute bottom-4 left-4 z-40">
			{open ? (
				<div className="absolute bottom-12 left-0 z-50 w-[320px] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl">
					<div className="border-b border-border/60 px-3 py-2 text-sm font-semibold">
						<strong>{t("nodeLibrary.createTitle")}</strong>
					</div>
					<NodeDefinitionGrid
						definitions={CONTENT_NODE_DEFINITIONS}
						onSelect={(kind) => {
							onAdd(kind);
							setOpen(false);
						}}
					/>
				</div>
			) : null}
			<div className="flex items-center gap-1 rounded-lg border border-border/70 bg-card/95 p-1 shadow-lg backdrop-blur">
				{quickDefinitions.map((definition) => (
					<button
						key={definition.kind}
						type="button"
						className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						title={t(`node.kind.${definition.kind}`)}
						aria-label={t(`node.kind.${definition.kind}`)}
						onClick={() => onAdd(definition.kind)}
					>
						<NodeKindIcon kind={definition.kind} />
					</button>
				))}
				<span className="mx-0.5 h-5 w-px bg-border" />
				<button
					type="button"
					className={`flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors hover:bg-accent ${open ? "bg-accent text-foreground" : "text-muted-foreground"}`}
					aria-expanded={open}
					onClick={() => setOpen((value) => !value)}
				>
				<AddIcon />
				<span>{t("nodeLibrary.title")}</span>
				</button>
			</div>
		</div>
	);
}
