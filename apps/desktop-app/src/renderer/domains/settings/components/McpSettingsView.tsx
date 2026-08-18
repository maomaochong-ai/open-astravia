import { useTranslation } from "react-i18next";
import { BuiltinMcpSecretsDialog } from "./BuiltinMcpSecretsDialog";
import { McpStorePanel } from "./McpServerList";
import type { McpSettingsModel } from "./useMcpSettingsModel";

/** MCP 管理内容区（扩展 → 连接器 Tab）。AI 协助入口由扩展页顶栏右侧插槽提供。 */
export function McpSettingsView({ model }: { model: McpSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");

	if (!model.config) {
		return (
			<div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 opacity-60">
				<span className="text-[13px] text-muted-foreground/60">{t("loading")}</span>
			</div>
		);
	}

	return (
		<div className="w-full pb-6">
			<McpStorePanel model={model} />
			<BuiltinMcpSecretsDialog
				open={model.secretsDialogPreset !== null}
				preset={model.secretsDialogPreset}
				initialValues={model.secretsDialogInitial}
				saving={model.saving || (model.busyPresetName !== null && !model.secretsDialogAuthorizing)}
				authorizing={model.secretsDialogAuthorizing}
				error={model.secretsDialogError}
				onOpenChange={(open) => {
					if (!open) model.onCloseSecretsDialog();
				}}
				onConfirm={(values) => void model.onConfirmSecretsDialog(values)}
			/>
		</div>
	);
}
