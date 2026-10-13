import { ModelsProvidersSectionView } from "@vetta-org/theme-ui/settings";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { ModelsFetchedModelsDrawer } from "./ModelsFetchedModelsDrawer";
import { ModelsModelDialog } from "./ModelsModelDialog";
import { ModelsProviderDialog } from "./ModelsProviderDialog";
import { ModelsProviderRow } from "./ModelsProviderRow";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";

export function ModelsProvidersSection({ model }: { model: ModelsSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");

	return (
		<>
			<ModelsProvidersSectionView
				section={SETTINGS_SECTION["models-providers"]}
				labels={{
					localProviders: t("localProviders"),
					addProvider: t("addProvider"),
					noProvidersAdded: t("noProvidersAdded"),
				}}
				showAddButton={!model.addingProvider}
				onStartAdd={model.onStartAddProvider}
				empty={model.providerNames.length === 0}
				rows={model.providerNames.map((name) => (
					<ModelsProviderRow key={name} name={name} model={model} />
				))}
			/>
			<ModelsProviderDialog model={model} />
			<ModelsModelDialog model={model} />
			<ModelsFetchedModelsDrawer model={model} />
		</>
	);
}
