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
			<DialogContent className="max-h-[min(90vh,760px)] overflow-y-auto sm:max-w-[600px] rounded-2xl sm:rounded-[26px] p-6 sm:p-8 gap-6 border-border/30 bg-popover/95 backdrop-blur-xl shadow-2xl">
				<DialogHeader className="gap-3 pr-8 text-left">
					<div className="flex items-start gap-3.5">
						<div
							className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-primary/10 text-primary shadow-xs ring-1 ring-primary/15 transition-transform duration-200"
							aria-hidden="true"
						>
							<span className="icon-[solar--server-2-linear] h-5 w-5" />
						</div>
						<div className="space-y-1 min-w-0">
							<DialogTitle className="text-lg font-semibold tracking-tight text-foreground">
								{t("editingServer")}
							</DialogTitle>
							<DialogDescription className="text-[13px] leading-relaxed text-muted-foreground/80 truncate">
								{name ? t("mcpStore.editServerHint", { name }) : t("mcpStore.editServerFallback")}
							</DialogDescription>
						</div>
					</div>
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
