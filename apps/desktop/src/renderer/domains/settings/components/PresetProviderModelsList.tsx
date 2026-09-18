import {
	PresetProviderModelsListView,
	type PresetProviderModelsListViewLabels,
} from "@vetta-org/theme-ui/settings";
import { useMemo, useState } from "react";
import type {
	PresetProviderRow,
	PresetProvidersSectionLabels,
} from "./usePresetProvidersSectionModel";

export function PresetProviderModelsList({
	row,
	labels,
}: {
	row: PresetProviderRow;
	labels: PresetProvidersSectionLabels;
}): JSX.Element {
	const [searchQuery, setSearchQuery] = useState("");
	const [legacyExpanded, setLegacyExpanded] = useState(false);
	const normalizedQuery = searchQuery.trim().normalize("NFKC").toLocaleLowerCase();
	const modelRows = useMemo(() => {
		// 搜索永远覆盖全集:代际收敛只决定默认展示什么,不能让用户搜不到自己要的老模型。
		if (normalizedQuery) {
			return [...row.modelRows, ...row.legacyModelRows].filter((model) => {
				const searchable = `${model.name}\n${model.id}`.normalize("NFKC").toLocaleLowerCase();
				return searchable.includes(normalizedQuery);
			});
		}
		return legacyExpanded ? [...row.modelRows, ...row.legacyModelRows] : row.modelRows;
	}, [legacyExpanded, normalizedQuery, row.legacyModelRows, row.modelRows]);
	const viewLabels: PresetProviderModelsListViewLabels = {
		clearSearch: labels.clearModelSearch,
		showLegacyModels: labels.showLegacyModels,
		hideLegacyModels: labels.hideLegacyModels,
		listLabel: labels.modelListLabel(row.displayName),
		noMatchingModels: labels.noMatchingModels,
		noModels: labels.noModels,
		perMillionTokens: labels.perMillionTokens,
		searchPlaceholder: labels.searchModels(row.displayName),
		thinking: labels.thinking,
	};
	return (
		<PresetProviderModelsListView
			labels={viewLabels}
			modelRows={modelRows}
			onSearchQueryChange={setSearchQuery}
			searchQuery={searchQuery}
			totalModelCount={row.modelRows.length + row.legacyModelRows.length}
			// 搜索时结果已含历史模型,再给展开入口只会让人以为还有东西没搜到。
			legacyModelCount={normalizedQuery ? 0 : row.legacyModelRows.length}
			legacyExpanded={legacyExpanded}
			onToggleLegacy={() => setLegacyExpanded((expanded) => !expanded)}
		/>
	);
}
