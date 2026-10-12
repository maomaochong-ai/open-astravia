import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@vetta-org/ui";
import { SegmentedControl } from "@vetta-org/theme-ui/shared";
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
				className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-[500px] rounded-2xl p-6 gap-5 border border-border/60 bg-popover shadow-2xl"
				id={section.id}
				data-setting-section-id={section.id}
				data-setting-section-highlight-target={section.id}
			>
				{/* 顶栏：标题、描述及正下方的模式切换 Tab */}
				<div className="space-y-3">
					<DialogHeader className="gap-1 pr-6 text-left">
						<DialogTitle className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
							<span className="icon-[solar--server-2-linear] h-4.5 w-4.5 text-primary shrink-0" aria-hidden="true" />
							<span>{t("mcpStore.customConnectorTitle")}</span>
						</DialogTitle>
						<DialogDescription className="text-xs text-muted-foreground leading-normal">
							{usingJson ? t("mcpStore.jsonHint") : t("mcpStore.manualHint")}
						</DialogDescription>
					</DialogHeader>

					<div>
						<SegmentedControl
							items={[
								{
									key: "visual",
									label: t("mcpStore.useFormConfig"),
								},
								{
									key: "json",
									label: t("mcpStore.useJsonConfig"),
								},
							]}
							value={model.mode}
							onChange={(nextMode) => model.onModeSwitch(nextMode)}
						/>
					</div>
				</div>

				{/* 主体表单区 */}
				<div className="min-w-0">
					{usingJson ? (
						<div className="space-y-2">
							<span className="block text-xs font-medium text-foreground/85">
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
								<div
									id={jsonErrorId}
									className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive animate-in fade-in-50 duration-150"
									role="alert"
								>
									<span
										className="icon-[solar--danger-triangle-linear] h-4 w-4 shrink-0"
										aria-hidden="true"
									/>
									<span>{model.jsonError}</span>
								</div>
							) : null}
						</div>
					) : (
						<McpServerFields form={model.serverForm} setForm={model.setServerForm} />
					)}
				</div>

				{/* 底部操作区：右对齐与输入框右缘完全平齐 */}
				<div className="flex items-center justify-end gap-2.5 pt-1">
					<Button
						variant="ghost"
						size="sm"
						onClick={model.onCancelAddServer}
						className="h-8 rounded-lg px-3.5 text-xs text-muted-foreground hover:text-foreground"
					>
						{t("cancel")}
					</Button>
					<Button
						variant="primary"
						size="sm"
						disabled={!canSave || model.saving}
						onClick={() => void (usingJson ? model.onAddServersFromJson() : model.onAddServer())}
						className="h-8 rounded-lg px-4 text-xs font-medium shadow-xs"
					>
						{t("addServer")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
