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
			<DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-[560px]">
				<DialogHeader className="border-b border-border/50 pb-4 pr-6">
					<DialogTitle className="flex items-center gap-2.5">
						<span
							className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"
							aria-hidden="true"
						>
							<span className="icon-[solar--server-linear] h-4 w-4" />
						</span>
						{t("editingServer")}
					</DialogTitle>
					<DialogDescription className="truncate">
						{name ? t("mcpStore.editServerHint", { name }) : t("mcpStore.editServerFallback")}
					</DialogDescription>
				</DialogHeader>
				<div className="mt-2">
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
