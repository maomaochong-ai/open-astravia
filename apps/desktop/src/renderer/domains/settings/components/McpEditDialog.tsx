import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@vetta-org/ui";
import { useTranslation } from "react-i18next";
import { McpServerForm } from "./McpServerForm";
import type { McpSettingsModel } from "./useMcpSettingsModel";

/** 编辑已添加 MCP：与手动添加同一套弹窗形态（能力详情本身是抽屉，不能再套一层抽屉）。 */
export function McpEditDialog({ model }: { model: McpSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");
	const open = model.editingServer !== null;
	const name = model.editingServer;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) model.onCancelEditServer();
			}}
		>
			<DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-[500px] rounded-2xl p-6 gap-5 border border-border/60 bg-popover shadow-2xl">
				<DialogHeader className="gap-1 pr-0 text-left">
					<DialogTitle className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
						<span className="icon-[solar--server-2-linear] h-4.5 w-4.5 text-primary shrink-0" aria-hidden="true" />
						<span>{t("editingServer")}</span>
					</DialogTitle>
					<DialogDescription className="text-xs text-muted-foreground leading-normal truncate">
						{name ? t("mcpStore.editServerHint", { name }) : t("mcpStore.editServerFallback")}
					</DialogDescription>
				</DialogHeader>
				<div className="min-w-0">
					{name ? (
						<McpServerForm
							form={model.serverForm}
							setForm={model.setServerForm}
							onSave={() => void model.onUpdateServer(name)}
							onCancel={model.onCancelEditServer}
							saving={model.saving}
							saveLabel={t("save")}
						/>
					) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
