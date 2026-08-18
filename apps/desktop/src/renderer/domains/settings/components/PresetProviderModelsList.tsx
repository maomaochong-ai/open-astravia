import {
	PresetProviderModelsListView,
	type PresetProviderModelsListViewLabels,
} from "@vetta/theme-ui/settings";
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
	const viewLabels: PresetProviderModelsListViewLabels = {
		noModels: labels.noModels,
		perMillionTokens: labels.perMillionTokens,
		thinking: labels.thinking,
	};
	return <PresetProviderModelsListView labels={viewLabels} modelRows={row.modelRows} />;
}
