import { useTranslation } from "@vetta-org/plugin-sdk";
import { useMemo, useState } from "react";
import {
	CONTENT_NODE_DEFINITIONS,
	type ContentNodeCategory,
	type ContentNodeDefinition,
} from "../domain/node-definitions";
import type { ContentNodeKind } from "../domain/model";
import { AddIcon } from "./icons";

const CATEGORY_ORDER: ContentNodeCategory[] = ["input", "generation", "resource", "output"];

interface NodeDefinitionGridProps {
	definitions: readonly ContentNodeDefinition[];
	onSelect: (kind: ContentNodeKind) => void;
}

export function NodeDefinitionGrid({ definitions, onSelect }: NodeDefinitionGridProps) {
	const { t } = useTranslation();

	if (definitions.length === 0) {
		return <p className="content-creation-muted">{t("nodeLibrary.empty")}</p>;
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
								<button
									key={definition.kind}
									type="button"
									className="content-creation-node-option"
									onClick={() => onSelect(definition.kind)}
								>
									<strong>{t(`node.kind.${definition.kind}`)}</strong>
									<span>{t(definition.descriptionKey)}</span>
								</button>
							))}
						</div>
					</section>
				);
			})}
		</div>
	);
}

interface NodeLibraryProps {
	onAdd: (kind: ContentNodeKind) => void;
}

export function NodeLibrary({ onAdd }: NodeLibraryProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const definitions = useMemo(() => {
		const normalizedQuery = query.trim().toLocaleLowerCase();
		if (!normalizedQuery) return CONTENT_NODE_DEFINITIONS;
		return CONTENT_NODE_DEFINITIONS.filter((definition) => {
			const text = `${t(`node.kind.${definition.kind}`)} ${t(definition.descriptionKey)}`.toLocaleLowerCase();
			return text.includes(normalizedQuery);
		});
	}, [query, t]);

	return (
		<div className="content-creation-node-library">
			<button type="button" className="content-creation-toolbar-button" onClick={() => setOpen((value) => !value)}>
				<AddIcon />
				{t("nodeLibrary.title")}
			</button>
			{open ? (
				<div className="content-creation-node-library__popover">
					<div className="content-creation-node-library__header">
						<strong>{t("nodeLibrary.title")}</strong>
						<span>{t("nodeLibrary.description")}</span>
					</div>
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("nodeLibrary.search")}
					/>
					<NodeDefinitionGrid
						definitions={definitions}
						onSelect={(kind) => {
							onAdd(kind);
							setOpen(false);
							setQuery("");
						}}
					/>
				</div>
			) : null}
		</div>
	);
}
