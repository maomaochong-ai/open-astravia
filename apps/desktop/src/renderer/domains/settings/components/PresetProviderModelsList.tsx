import {
	PresetProviderModelsListView,
	type PresetProviderModelTestState,
	type PresetProviderModelsListViewLabels,
} from "@astravia-org/theme-ui/settings";
import { useMemo, useState } from "react";
import type {
	PresetProviderRow,
	PresetProvidersSectionLabels,
} from "./usePresetProvidersSectionModel";

export function PresetProviderModelsList({
	row,
	labels,
	onTestModel,
	testStates,
}: {
	row: PresetProviderRow;
	labels: PresetProvidersSectionLabels;
	/** 逐行连通测试；未采纳的服务商不给，列表里就不出现测试按钮。 */
	onTestModel?: (model: string) => void;
	testStates?: Readonly<Record<string, PresetProviderModelTestState>>;
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
		testModel: labels.testModel,
		testOk: labels.testOk,
		testFailed: labels.testFailed,
	};
	return (
		<PresetProviderModelsListView
			labels={viewLabels}
			modelRows={testStates ? modelRows.map((model) => ({ ...model, test: testStates[model.id] })) : modelRows}
			{...(onTestModel ? { onTestModel } : {})}
			onSearchQueryChange={setSearchQuery}
			searchQuery={searchQuery}
			totalModelCount={row.modelRows.length}
		/>
	);
}
