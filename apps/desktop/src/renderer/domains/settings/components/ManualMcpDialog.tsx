import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vetta-org/ui";
import { SegmentedControl } from "@shared/components/ui/segmented-control";
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
				className="max-h-[min(90vh,760px)] overflow-y-auto sm:max-w-[600px] rounded-2xl sm:rounded-[26px] p-6 sm:p-8 gap-6 border-border/30 bg-popover/95 backdrop-blur-xl shadow-2xl"
				id={section.id}
				data-setting-section-id={section.id}
				data-setting-section-highlight-target={section.id}
			>
				{/* 头部：去线留白，Apple squircle 质感徽章与呼吸感字阶 */}
				<div className="space-y-4">
					<DialogHeader className="gap-3 pr-8 text-left">
						<div className="flex items-start gap-3.5">
							<div
								className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-primary/10 text-primary shadow-xs ring-1 ring-primary/15 transition-transform duration-200"
								aria-hidden="true"
							>
								<span className="icon-[solar--server-2-linear] h-5 w-5" />
							</div>
							<div className="space-y-1">
								<DialogTitle className="text-lg font-semibold tracking-tight text-foreground">
									{t("mcpStore.customConnectorTitle")}
								</DialogTitle>
								<DialogDescription className="text-[13px] leading-relaxed text-muted-foreground/80">
									{usingJson ? t("mcpStore.jsonHint") : t("mcpStore.manualHint")}
								</DialogDescription>
							</div>
						</div>
					</DialogHeader>

					{/* 模式选择 Segmented Control：Apple 顶级交互的核心，位于头部中枢 */}
					<div className="flex items-center pt-0.5">
						<SegmentedControl
							items={[
								{
									key: "visual",
									label: t("mcpStore.useFormConfig"),
									icon: "icon-[solar--slider-minimalistic-horizontal-linear]",
								},
								{
									key: "json",
									label: t("mcpStore.useJsonConfig"),
									icon: "icon-[solar--code-circle-linear]",
								},
							]}
							value={model.mode}
							onChange={(nextMode) => model.onModeSwitch(nextMode)}
							className="w-full sm:w-auto"
						/>
					</div>
				</div>

				{/* 主体内容区：纯净自然流动 */}
				<div className="min-w-0">
					{usingJson ? (
						<div className="space-y-2.5">
							<span className="block text-[12px] font-medium text-foreground/85">
								{t("mcpStore.jsonInputLabel")}
							</span>
							<div className="overflow-hidden rounded-2xl bg-muted/20 dark:bg-muted/10 p-2.5 transition-all ring-1 ring-border/20 focus-within:ring-2 focus-within:ring-primary/30">
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
							</div>
							{model.jsonError ? (
								<span
									id={jsonErrorId}
									className="flex items-center gap-2 rounded-xl bg-destructive/10 px-3.5 py-2.5 text-[12px] font-medium text-destructive animate-in fade-in-50 duration-200"
									role="alert"
								>
									<span
										className="icon-[solar--danger-triangle-linear] h-4 w-4 shrink-0"
										aria-hidden="true"
									/>
									{model.jsonError}
								</span>
							) : null}
						</div>
					) : (
						<McpServerFields form={model.serverForm} setForm={model.setServerForm} />
					)}
				</div>

				{/* 底部操作区：去线留白，轻盈沉底 */}
				<DialogFooter className="mt-1 pt-1 gap-2.5 sm:justify-end flex-row justify-end">
					<Button
						variant="ghost"
						size="sm"
						onClick={model.onCancelAddServer}
						className="rounded-xl px-4 text-muted-foreground hover:text-foreground"
					>
						{t("cancel")}
					</Button>
					<Button
						variant="primary"
						size="sm"
						disabled={!canSave || model.saving}
						onClick={() => void (usingJson ? model.onAddServersFromJson() : model.onAddServer())}
						className="rounded-xl px-5 font-medium shadow-xs shadow-primary/25 transition-transform active:scale-[0.98]"
					>
						{t("addServer")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
