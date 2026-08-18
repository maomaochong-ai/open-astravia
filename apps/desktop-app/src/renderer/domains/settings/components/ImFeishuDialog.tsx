import { useTranslation } from "react-i18next";
import { ImFeishuDialogView } from "@vetta/theme-ui/settings";
import type { ImBridgeSettingsModel } from "./useImBridgeSettingsModel";

export function ImFeishuDialog({ model }: { model: ImBridgeSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");
	const statusMessage = model.saveError
		? model.saveError
		: model.saveOk && !model.saveError
			? model.saveOk
			: model.testResult && !model.saveError && !model.saveOk
				? model.testResult
				: null;
	const statusTone = model.saveError
		? "error"
		: model.saveOk && !model.saveError
			? "ok"
			: model.testResult
				? "muted"
				: null;

	return (
		<ImFeishuDialogView
			open={model.feishuDialogOpen}
			onOpenChange={model.setFeishuDialogOpen}
			appId={model.feishuForm.appId}
			appSecret={model.feishuForm.appSecret}
			showSecret={model.showSecret}
			onToggleSecret={() => model.setShowSecret((value) => !value)}
			onAppIdChange={(value) => model.updateFeishuField("appId", value)}
			onAppSecretChange={(value) => model.updateFeishuField("appSecret", value)}
			appIdError={Boolean(model.feishuValidation.errors.appId)}
			appSecretError={Boolean(model.feishuValidation.errors.appSecret)}
			statusMessage={statusMessage}
			statusTone={statusTone}
			testing={model.testing}
			saving={model.saving}
			canTest={model.feishuValidation.valid}
			canSave={model.feishuValidation.valid}
			onTest={() => void model.onTestFeishu()}
			onSave={() => void model.onSaveFeishu()}
			labels={{
				title: t("feishuSettingsTitle"),
				description: t("feishuDesc"),
				hide: t("hide"),
				show: t("show"),
				testing: t("testing"),
				testConnection: t("testConnection"),
				saving: t("savingLabel"),
				save: t("saveLabel"),
			}}
		/>
	);
}
