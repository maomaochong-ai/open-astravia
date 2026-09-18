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
	const normalizedQuery = searchQuery.trim().normalize("NFKC").toLocaleLowerCase();
	const modelRows = useMemo(() => {
		if (!normalizedQuery) return row.modelRows;
		return row.modelRows.filter((model) => {
			const searchable = `${model.name}\n${model.id}`.normalize("NFKC").toLocaleLowerCase();
			return searchable.includes(normalizedQuery);
		});
	}, [normalizedQuery, row.modelRows]);
	const viewLabels: PresetProviderModelsListViewLabels = {
		clearSearch: labels.clearModelSearch,
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
			totalModelCount={row.modelRows.length}
		/>
	);
}
