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

/** 「添加服务商」对话框：承载原行内表单，保存后展开新服务商行继续添加模型。 */
export function ModelsProviderDialog({ model }: { model: ModelsSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");

	return (
		<Dialog
			open={model.addingProvider}
			onOpenChange={(next) => {
				if (!next) model.onCancelAddProvider();
			}}
		>
			<DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-[520px] rounded-2xl p-6 gap-5 border border-border/60 bg-popover shadow-2xl">
				<DialogHeader className="gap-1 pr-6 text-left">
					<DialogTitle className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
						<span className="icon-[mdi--server-plus-outline] h-4.5 w-4.5 text-primary shrink-0" aria-hidden="true" />
						<span>{t("addProvider")}</span>
					</DialogTitle>
					<DialogDescription className="text-xs text-muted-foreground leading-normal">
						{t("addProviderHint")}
					</DialogDescription>
				</DialogHeader>
				<ModelsProviderForm
					form={model.providerForm}
					setForm={model.setProviderForm}
					onSave={() => void model.onAddProvider()}
					onCancel={model.onCancelAddProvider}
					saving={model.saving}
					saveLabel={t("add")}
				/>
			</DialogContent>
		</Dialog>
	);
}
