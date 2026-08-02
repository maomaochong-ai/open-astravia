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
		return <p className="content-creation-muted">{t("nodeLibrary.empty")}</p>;
	}

	if (!showCategories) {
		return (
			<div className="content-creation-node-library__grid is-starter">
				{definitions.map((definition) => (
					<NodeDefinitionButton key={definition.kind} definition={definition} onSelect={onSelect} />
				))}
			</div>
		);
	}

	return (
		<div className="content-creation-node-library__groups">
			{CATEGORY_ORDER.map((category) => {
				const categoryDefinitions = definitions.filter((definition) => definition.category === category);
				if (categoryDefinitions.length === 0) return null;
				return (
					<section key={category} className="content-creation-node-library__group">
						<h4>{t(`node.category.${category}`)}</h4>
						<div className="content-creation-node-library__grid">
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
		<button type="button" className="content-creation-node-option" onClick={() => onSelect(definition.kind)}>
			<span className={`content-creation-node-option__icon is-${definition.accent}`}>
				<NodeKindIcon kind={definition.kind} />
			</span>
			<span className="content-creation-node-option__copy">
				<strong>{t(`node.kind.${definition.kind}`)}</strong>
				<span>{t(definition.descriptionKey)}</span>
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
		<section className="content-creation-empty">
			<h2>{t("graph.empty.title")}</h2>
			<p>{t("graph.empty.description")}</p>
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
			className="content-creation-node-library__popover is-contextual nodrag nowheel"
			style={{ left, top }}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<div className="content-creation-node-library__header">
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
		<div ref={rootRef} className="content-creation-node-library">
			{open ? (
				<div className="content-creation-node-library__popover">
					<div className="content-creation-node-library__header">
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
			<div className="content-creation-canvas-dock">
				{quickDefinitions.map((definition) => (
					<button
						key={definition.kind}
						type="button"
						className="content-creation-canvas-dock__tool"
						title={t(`node.kind.${definition.kind}`)}
						aria-label={t(`node.kind.${definition.kind}`)}
						onClick={() => onAdd(definition.kind)}
					>
						<NodeKindIcon kind={definition.kind} />
					</button>
				))}
				<span className="content-creation-canvas-dock__divider" />
				<button
					type="button"
					className={`content-creation-canvas-dock__add ${open ? "is-active" : ""}`}
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
