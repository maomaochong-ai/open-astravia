import type { ModelsConfigData } from "@preload/api.js";
import { PresetProvidersSectionView } from "./PresetProvidersSectionView";
import { usePresetProvidersSectionModel } from "./usePresetProvidersSectionModel";

export function PresetProvidersSection({
	config,
	saveConfig,
}: {
	config: ModelsConfigData;
	saveConfig: (config: ModelsConfigData) => Promise<void>;
}): JSX.Element {
	const model = usePresetProvidersSectionModel({ config, saveConfig });
	return <PresetProvidersSectionView model={model} />;
}
