import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vetta-org/ui";
import { JsonConfigInputView } from "@vetta-org/theme-ui/settings";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { McpServerFields } from "./McpServerForm";
import { isMcpFormValid, type McpSettingsModel } from "./useMcpSettingsModel";

const MCP_JSON_PLACEHOLDER = `{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}`;

/** 手动添加自定义 MCP 连接器对话框。 */
export function ManualMcpDialog({ model }: { model: McpSettingsModel }): JSX.Element {
	const { t } = useTranslation("settings");
	const jsonErrorId = useId();
	const open = model.addingServer;
	const section = SETTINGS_SECTION["mcp-server-list"];
	const usingJson = model.mode === "json";
	const canSave = usingJson ? Boolean(model.jsonText.trim()) : isMcpFormValid(model.serverForm);

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
					<DialogDescription>
						{usingJson ? t("mcpStore.jsonHint") : t("mcpStore.manualHint")}
					</DialogDescription>
				</DialogHeader>
				<div className="mt-2">
					{usingJson ? (
						<div className="grid gap-1.5">
							<span className="text-[11px] font-medium text-muted-foreground">
								{t("mcpStore.jsonInputLabel")}
							</span>
							<JsonConfigInputView
								value={model.jsonText}
								onValueChange={(value) => {
									model.setJsonText(value);
									model.clearJsonError();
								}}
								placeholder={MCP_JSON_PLACEHOLDER}
								ariaLabel={t("mcpStore.jsonInputLabel")}
								ariaInvalid={Boolean(model.jsonError)}
								ariaDescribedBy={model.jsonError ? jsonErrorId : undefined}
							/>
							{model.jsonError ? (
								<span
									id={jsonErrorId}
									className="flex items-center gap-1.5 text-[11px] text-destructive"
									role="alert"
								>
									<span className="icon-[solar--danger-triangle-linear] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
									{model.jsonError}
								</span>
							) : null}
						</div>
					) : (
						<McpServerFields form={model.serverForm} setForm={model.setServerForm} />
					)}
				</div>
				<DialogFooter className="gap-2 sm:justify-between">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => model.onModeSwitch(usingJson ? "visual" : "json")}
					>
						<span
							className={usingJson ? "icon-[solar--settings-linear]" : "icon-[solar--code-linear]"}
							aria-hidden="true"
						/>
						{usingJson ? t("mcpStore.useFormConfig") : t("mcpStore.useJsonConfig")}
					</Button>
					<div className="flex items-center justify-end gap-2">
						<Button variant="ghost" size="sm" onClick={model.onCancelAddServer}>
							{t("cancel")}
						</Button>
						<Button
							variant="primary"
							size="sm"
							disabled={!canSave || model.saving}
							onClick={() => void (usingJson ? model.onAddServersFromJson() : model.onAddServer())}
						>
							{t("addServer")}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
