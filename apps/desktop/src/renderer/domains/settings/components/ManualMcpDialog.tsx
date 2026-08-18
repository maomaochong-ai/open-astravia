import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@vetta/ui";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { McpServerForm } from "./McpServerForm";
import type { McpSettingsModel } from "./useMcpSettingsModel";

/** 手动添加自定义 MCP 连接器对话框。 */
export function ManualMcpDialog({ model }: { model: McpSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");
	const open = model.addingServer;
	const section = SETTINGS_SECTION["mcp-server-list"];

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) model.onCancelAddServer();
			}}
		>
			<DialogContent
				className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-[520px]"
				id={section.id}
				data-setting-section-id={section.id}
				data-setting-section-highlight-target={section.id}
			>
				<DialogHeader>
					<DialogTitle>{t("mcpStore.customConnectorTitle")}</DialogTitle>
					<DialogDescription>{t("mcpStore.manualHint")}</DialogDescription>
				</DialogHeader>
				<div className="mt-2">
					<McpServerForm
						form={model.serverForm}
						setForm={model.setServerForm}
						onSave={() => void model.onAddServer()}
						onCancel={model.onCancelAddServer}
						saving={model.saving}
						saveLabel={t("addServer")}
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
