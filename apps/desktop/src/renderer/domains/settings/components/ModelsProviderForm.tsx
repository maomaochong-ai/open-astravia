import { useTranslation } from "react-i18next";
import { ModelsProviderFormView } from "@vetta/theme-ui/settings";
import { API_OPTIONS, type ProviderFormState } from "./useModelsSettingsModel";

export function ModelsProviderForm({
	form,
	setForm,
	onSave,
	onCancel,
	saving,
	saveLabel,
	replacingApiKey = false,
	onCopyApiKey,
}: {
	form: ProviderFormState;
	setForm: React.Dispatch<React.SetStateAction<ProviderFormState>>;
	onSave: () => void;
	onCancel: () => void;
	saving: boolean;
	saveLabel: string;
	replacingApiKey?: boolean;
	onCopyApiKey?: () => void;
}): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<ModelsProviderFormView
			form={form}
			onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
			onSave={onSave}
			onCancel={onCancel}
			saving={saving}
			saveLabel={saveLabel}
			apiOptions={API_OPTIONS}
			onCopyApiKey={onCopyApiKey}
			labels={{
				providerName: t("providerName"),
				apiType: t("apiType"),
				apiKeyPlaceholder: t(replacingApiKey ? "replaceApiKeyPlaceholder" : "apiKeyPlaceholder"),
				customHeaders: t("customHeaders"),
				useAuthHeader: t("useAuthHeader"),
				cancel: t("cancel"),
				namePlaceholder: "e.g. ollama, lm-studio",
				baseUrlPlaceholder: "e.g. http://localhost:11434/v1",
				copyApiKey: t("copyApiKey"),
			}}
		/>
	);
}
