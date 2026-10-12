import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, cn } from "@vetta-org/ui";
import { SegmentedControl } from "@vetta-org/theme-ui/shared";
import { getMcpAuthorization, setMcpAuthorization } from "./mcp-authorization-header";
import { CheckboxField, InputField, TextareaField } from "@vetta-org/theme-ui/settings";
import { isMcpFormValid, type McpServerFormState, type McpTransportType } from "./useMcpSettingsModel";

export function McpServerForm({
	form,
	setForm,
	onSave,
	onCancel,
	saving,
	saveLabel,
}: {
	form: McpServerFormState;
	setForm: React.Dispatch<React.SetStateAction<McpServerFormState>>;
	onSave: () => void;
	onCancel: () => void;
	saving: boolean;
	saveLabel: string;
}): JSX.Element {
	const { t } = useTranslation("settings");

	return (
		<div className="space-y-5">
			<McpServerFields form={form} setForm={setForm} />

			<div className="flex items-center justify-end gap-2.5 pt-2">
				<Button
					variant="ghost"
					size="sm"
					onClick={onCancel}
					className="h-8 rounded-lg px-3.5 text-xs text-muted-foreground hover:text-foreground"
				>
					{t("cancel")}
				</Button>
				<Button
					variant="primary"
					size="sm"
					onClick={onSave}
					disabled={!isMcpFormValid(form) || saving}
					className="h-8 rounded-lg px-4 text-xs font-medium shadow-xs"
				>
					{saveLabel}
				</Button>
			</div>
		</div>
	);
}

/** MCP 表单字段。添加弹窗与编辑弹窗各自组合所需的底部操作。 */
export function McpServerFields({
	form,
	setForm,
}: {
	form: McpServerFormState;
	setForm: React.Dispatch<React.SetStateAction<McpServerFormState>>;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const [advancedOpen, setAdvancedOpen] = useState(() => hasAdvancedValues(form));

	return (
		<div className="space-y-4">
			{/* 协议选择：与下方表单字段保持一致的对齐基准线 */}
			<div className="flex items-center justify-between pb-0.5">
				<span className="text-xs font-medium text-foreground/85">{t("transportType")}</span>
				<SegmentedControl
					items={[
						{ key: "stdio" as McpTransportType, label: t("stdio") },
						{ key: "http" as McpTransportType, label: "HTTP" },
					]}
					value={form.transport}
					onChange={(transport) => setForm((current) => ({ ...current, transport }))}
				/>
			</div>

			{/* 基础必填字段：全宽单列严密对齐 */}
			<div className="space-y-3.5">
				<label className="block space-y-1.5">
					<span className="block text-xs font-medium text-foreground/85">
						{t("serverName")} <span className="text-destructive">*</span>
					</span>
					<InputField
						aria-label={t("serverName")}
						value={form.name}
						onChange={(value) => setForm((current) => ({ ...current, name: value }))}
						placeholder={t("mcpStore.namePlaceholder")}
						className="h-9 w-full rounded-lg border-border/60 bg-background/50 hover:bg-background focus-visible:bg-background focus-visible:border-primary/60 text-xs px-3 transition-colors"
					/>
				</label>

				{form.transport === "stdio" ? (
					<StdioBasicFields form={form} setForm={setForm} />
				) : (
					<HttpBasicFields form={form} setForm={setForm} />
				)}
			</div>

			{/* 高级选项：系统折叠触发器与对称网格 */}
			<div className="space-y-3 pt-1">
				<button
					type="button"
					aria-expanded={advancedOpen}
					onClick={() => setAdvancedOpen((open) => !open)}
					className="group inline-flex items-center gap-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground select-none"
				>
					<span
						className={cn(
							"icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 transition-transform duration-200 text-muted-foreground/70 group-hover:text-foreground",
							advancedOpen && "rotate-90",
						)}
					/>
					<span>{t("advancedOptions")}</span>
				</button>

				{advancedOpen && (
					<div className="space-y-3.5 pt-1 animate-in fade-in-50 duration-150">
						{form.transport === "stdio" ? (
							<StdioAdvancedFields form={form} setForm={setForm} />
						) : (
							<HttpAdvancedFields form={form} setForm={setForm} />
						)}

						{/* 两个短输入字段形成等宽 1:1 对称网格，消除右侧留白空洞 */}
						<div className="grid grid-cols-2 gap-3">
							<label className="block space-y-1.5">
								<span className="block text-xs font-medium text-foreground/85 truncate">{t("startupTimeout")}</span>
								<InputField
									aria-label={t("startupTimeout")}
									value={form.startupTimeout}
									onChange={(value) => setForm((current) => ({ ...current, startupTimeout: value }))}
									placeholder={t("default10000")}
									className="h-9 w-full rounded-lg border-border/60 bg-background/50 hover:bg-background focus-visible:bg-background focus-visible:border-primary/60 text-xs px-3 font-mono transition-colors"
								/>
							</label>
							<label className="block space-y-1.5">
								<span className="block text-xs font-medium text-foreground/85 truncate">{t("autoApproveTools")}</span>
								<InputField
									aria-label={t("autoApproveTools")}
									value={form.autoApprove}
									onChange={(value) => setForm((current) => ({ ...current, autoApprove: value }))}
									placeholder={t("mcpStore.autoApprovePlaceholder")}
									className="h-9 w-full rounded-lg border-border/60 bg-background/50 hover:bg-background focus-visible:bg-background focus-visible:border-primary/60 text-xs px-3 font-mono transition-colors"
								/>
							</label>
						</div>

						<div className="flex items-center gap-6 pt-0.5">
							<CheckboxField
								checked={form.disabled}
								onChange={(value) => setForm((current) => ({ ...current, disabled: value }))}
								label={t("disable")}
							/>
							<CheckboxField
								checked={form.debug}
								onChange={(value) => setForm((current) => ({ ...current, debug: value }))}
								label={t("debugMode")}
							/>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function hasAdvancedValues(form: McpServerFormState): boolean {
	return Boolean(
		form.env.trim() ||
			form.cwd.trim() ||
			form.headers.trim() ||
			form.autoApprove.trim() ||
			form.startupTimeout.trim() ||
			form.disabled ||
			form.debug,
	);
}

function StdioBasicFields({
	form,
	setForm,
}: {
	form: McpServerFormState;
	setForm: React.Dispatch<React.SetStateAction<McpServerFormState>>;
}): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<>
			<label className="block space-y-1.5">
				<span className="block text-xs font-medium text-foreground/85">
					{t("command")} <span className="text-destructive">*</span>
				</span>
				<InputField
					aria-label={t("command")}
					value={form.command}
					onChange={(value) => setForm((current) => ({ ...current, command: value }))}
					placeholder={t("mcpStore.commandPlaceholder")}
					className="h-9 w-full rounded-lg border-border/60 bg-background/50 hover:bg-background focus-visible:bg-background focus-visible:border-primary/60 text-xs px-3 font-mono transition-colors"
				/>
			</label>
			<label className="block space-y-1.5">
				<span className="block text-xs font-medium text-foreground/85">{t("arguments")}</span>
				<InputField
					aria-label={t("arguments")}
					value={form.args}
					onChange={(value) => setForm((current) => ({ ...current, args: value }))}
					placeholder={t("mcpStore.argsPlaceholder")}
					className="h-9 w-full rounded-lg border-border/60 bg-background/50 hover:bg-background focus-visible:bg-background focus-visible:border-primary/60 text-xs px-3 font-mono transition-colors"
				/>
			</label>
		</>
	);
}

function StdioAdvancedFields({
	form,
	setForm,
}: {
	form: McpServerFormState;
	setForm: React.Dispatch<React.SetStateAction<McpServerFormState>>;
}): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<>
			<label className="block space-y-1.5">
				<span className="block text-xs font-medium text-foreground/85">{t("envVariables")}</span>
				<TextareaField
					value={form.env}
					onChange={(value) => setForm((current) => ({ ...current, env: value }))}
					placeholder={"GITHUB_TOKEN=${GITHUB_TOKEN}\nNODE_ENV=production"}
					rows={3}
				/>
			</label>
			<label className="block space-y-1.5">
				<span className="block text-xs font-medium text-foreground/85">{t("workDirectory")}</span>
				<InputField
					value={form.cwd}
					onChange={(value) => setForm((current) => ({ ...current, cwd: value }))}
					placeholder="${PROJECT_ROOT}"
					className="h-9 w-full rounded-lg border-border/60 bg-background/50 hover:bg-background focus-visible:bg-background focus-visible:border-primary/60 text-xs px-3 font-mono transition-colors"
				/>
			</label>
		</>
	);
}

function HttpBasicFields({
	form,
	setForm,
}: {
	form: McpServerFormState;
	setForm: React.Dispatch<React.SetStateAction<McpServerFormState>>;
}): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<>
			<label className="block space-y-1.5">
				<span className="block text-xs font-medium text-foreground/85">
					{t("sseUrl")} <span className="text-destructive">*</span>
				</span>
				<InputField
					aria-label={t("sseUrl")}
					value={form.url}
					onChange={(value) => setForm((current) => ({ ...current, url: value }))}
					placeholder={t("mcpStore.urlPlaceholder")}
					className="h-9 w-full rounded-lg border-border/60 bg-background/50 hover:bg-background focus-visible:bg-background focus-visible:border-primary/60 text-xs px-3 font-mono transition-colors"
				/>
			</label>
			<label className="block space-y-1.5">
				<span className="flex items-center gap-1.5 text-xs font-medium text-foreground/85">
					<span className="icon-[solar--key-minimalistic-square-linear] h-3.5 w-3.5 text-muted-foreground/75" aria-hidden="true" />
					{t("mcpStore.authorizationKey")}
				</span>
				<InputField
					type="password"
					aria-label={t("mcpStore.authorizationKey")}
					value={getMcpAuthorization(form.headers)}
					onChange={(value) =>
						setForm((current) => ({ ...current, headers: setMcpAuthorization(current.headers, value) }))
					}
					placeholder={t("mcpStore.authorizationPlaceholder")}
					className="h-9 w-full rounded-lg border-border/60 bg-background/50 hover:bg-background focus-visible:bg-background focus-visible:border-primary/60 text-xs px-3 font-mono transition-colors"
				/>
				<span className="block text-[11px] leading-relaxed text-muted-foreground/75">
					{t("mcpStore.authorizationHint")}
				</span>
			</label>
		</>
	);
}

function HttpAdvancedFields({
	form,
	setForm,
}: {
	form: McpServerFormState;
	setForm: React.Dispatch<React.SetStateAction<McpServerFormState>>;
}): JSX.Element {
	const { t } = useTranslation("settings");
	return (
		<label className="block space-y-1.5">
			<span className="block text-xs font-medium text-foreground/85">{t("requestHeaders")}</span>
			<TextareaField
				value={form.headers}
				onChange={(value) => setForm((current) => ({ ...current, headers: value }))}
				placeholder={"Authorization=Bearer ${EXA_TOKEN}"}
				rows={2}
			/>
		</label>
	);
}
