import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@vetta-org/ui";
import { useTranslation } from "react-i18next";
import { ModelsProviderForm } from "./ModelsProviderForm";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";

/**
 * 「添加 / 编辑服务商」对话框：两种模式共用同一枚表单。
 * 编辑模式下未重填的 API Key 沿用服务商已存的密钥（占位符提示已加密保存）。
 */
export function ModelsProviderDialog({ model }: { model: ModelsSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");

	const editingName = model.editingProvider;
	const open = model.addingProvider || editingName !== null;
	const editingProvider = editingName ? model.config?.providers[editingName] : undefined;

	const close = (): void => {
		if (model.addingProvider) model.onCancelAddProvider();
		else if (editingName) model.onCancelEditProvider();
	};

	const save = (): void => {
		if (model.addingProvider) void model.onAddProvider();
		else if (editingName) void model.onUpdateProvider(editingName);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) close();
			}}
		>
			<DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-[520px] rounded-2xl p-6 gap-5 border border-border/60 bg-popover shadow-2xl">
				<DialogHeader className="gap-1 pr-6 text-left">
					<DialogTitle className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
						<span className="icon-[mdi--server-plus-outline] h-4.5 w-4.5 text-primary shrink-0" aria-hidden="true" />
						<span>{model.addingProvider ? t("addProvider") : t("editProvider")}</span>
					</DialogTitle>
					<DialogDescription className="text-xs text-muted-foreground leading-normal">
						{t("addProviderHint")}
					</DialogDescription>
				</DialogHeader>
				<ModelsProviderForm
					form={model.providerForm}
					setForm={model.setProviderForm}
					onSave={save}
					onCancel={close}
					saving={model.saving}
					saveLabel={model.addingProvider ? t("add") : t("save")}
					replacingApiKey={Boolean(editingProvider?.apiKey)}
					onCopyApiKey={
						editingName && editingProvider?.apiKey ? () => void model.onCopyProviderApiKey(editingName) : undefined
					}
				/>
			</DialogContent>
		</Dialog>
	);
}
