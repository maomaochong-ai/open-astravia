import { useTranslation } from "react-i18next";
import { SettingsPageShellView } from "@vetta/theme-ui/settings";
import { SettingsAiAssist } from "../ai-assist";
import { ModelsProvidersSection } from "./ModelsProvidersSection";
import { PresetProvidersSection } from "./PresetProvidersSection";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";

export function ModelsSettingsView({ model }: { model: ModelsSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");

	return (
		<SettingsPageShellView
			title={model.config ? t("modelSettings.title") : t("modelsTitle")}
			headerAction={model.config ? <SettingsAiAssist tabId="models" /> : undefined}
			loading={!model.config}
			loadingLabel={t("loading")}
			footer={
				model.config ? (
					<div className="mt-6 text-center text-[11px] text-muted-foreground/60">
						{t("configFilePath")}: ~/.vetta/agent/models.json
					</div>
				) : undefined
			}
		>
			{model.config && (
				<>
					<PresetProvidersSection config={model.config} saveConfig={model.saveConfig} />
					<ModelsProvidersSection model={model} />
				</>
			)}
		</SettingsPageShellView>
	);
}
