import { ModelsProvidersSectionView } from "@vetta/theme-ui/settings";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { ModelsProviderForm } from "./ModelsProviderForm";
import { ModelsProviderRow } from "./ModelsProviderRow";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";

export function ModelsProvidersSection({ model }: { model: ModelsSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");

	return (
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
			addForm={
				model.addingProvider ? (
					<div className="border-t border-border px-5 py-4">
						<ModelsProviderForm
							form={model.providerForm}
							setForm={model.setProviderForm}
							onSave={() => void model.onAddProvider()}
							onCancel={model.onCancelAddProvider}
							saving={model.saving}
							saveLabel={t("add")}
						/>
					</div>
				) : null
			}
		/>
	);
}
