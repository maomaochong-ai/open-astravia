import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@vetta-org/ui";
import { SegmentedControl } from "@shared/components/ui/segmented-control";
import { getMcpAuthorization, setMcpAuthorization } from "./mcp-authorization-header";
import { cn } from "@shared/lib/utils";
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
		<div className="space-y-6">
			<McpServerFields form={form} setForm={setForm} />

			<div className="flex justify-end gap-2.5 pt-2">
				<Button
					variant="ghost"
					size="sm"
					onClick={onCancel}
					className="rounded-xl px-4 text-muted-foreground hover:text-foreground"
				>
					{t("cancel")}
				</Button>
				<Button
					variant="primary"
					size="sm"
					onClick={onSave}
					disabled={!isMcpFormValid(form) || saving}
					className="rounded-xl px-5 font-medium shadow-xs shadow-primary/25 transition-transform active:scale-[0.98]"
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
			{/* 协议类型切换：macOS 风格 Inset Row，无硬线 */}
			<div className="flex items-center justify-between rounded-2xl bg-muted/30 dark:bg-muted/15 px-4 py-3 transition-colors">
				<div className="flex items-center gap-2">
					<span className="icon-[solar--transmission-linear] h-4 w-4 text-muted-foreground/80" />
					<span className="text-[12px] font-medium text-foreground/85">{t("transportType")}</span>
				</div>
				<SegmentedControl
					items={[
						{ key: "stdio" as McpTransportType, label: t("stdio") },
						{ key: "http" as McpTransportType, label: "HTTP" },
					]}
					value={form.transport}
					onChange={(transport) => setForm((current) => ({ ...current, transport }))}
				/>
			</div>

			{/* 核心配置卡片：柔和底色，舒适留白 */}
			<div className="rounded-2xl bg-muted/30 dark:bg-muted/15 p-4 sm:p-5 grid grid-cols-2 gap-4">
				<div className={form.transport === "http" ? "col-span-2" : undefined}>
					<label className="mb-1.5 block text-[12px] font-medium text-foreground/85">
						{t("serverName")} <span className="text-primary/70">*</span>
					</label>
					<InputField
						aria-label={t("serverName")}
						value={form.name}
						onChange={(value) => setForm((current) => ({ ...current, name: value }))}
						placeholder={t("mcpStore.namePlaceholder")}
						className="h-9 rounded-xl border-border/40 bg-background/80 hover:bg-background focus-visible:bg-background focus-visible:border-primary/50 text-[13px] px-3 transition-colors"
					/>
				</div>
				{form.transport === "stdio" ? (
					<StdioBasicFields form={form} setForm={setForm} />
				) : (
					<HttpBasicFields form={form} setForm={setForm} />
				)}
			</div>

			{/* 高级选项：系统级折叠器，告别生硬横线 */}
			<div className="space-y-2.5 pt-1">
				<button
					type="button"
					aria-expanded={advancedOpen}
					onClick={() => setAdvancedOpen((open) => !open)}
					className="group inline-flex items-center gap-1.5 rounded-lg py-1 px-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground select-none"
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
					<div className="rounded-2xl bg-muted/20 dark:bg-muted/10 p-4 sm:p-5 grid grid-cols-2 gap-4 animate-in fade-in-50 duration-200">
						{form.transport === "stdio" ? (
							<StdioAdvancedFields form={form} setForm={setForm} />
						) : (
							<HttpAdvancedFields form={form} setForm={setForm} />
						)}
						<div>
							<label className="mb-1.5 block text-[12px] font-medium text-foreground/85">{t("startupTimeout")}</label>
							<InputField
								value={form.startupTimeout}
								onChange={(value) => setForm((current) => ({ ...current, startupTimeout: value }))}
								placeholder={t("default10000")}
								className="h-9 rounded-xl border-border/40 bg-background/80 hover:bg-background focus-visible:bg-background focus-visible:border-primary/50 text-[13px] px-3 font-mono transition-colors"
							/>
						</div>
						<div className="col-span-2">
							<label className="mb-1.5 block text-[12px] font-medium text-foreground/85">{t("autoApproveTools")}</label>
							<InputField
								value={form.autoApprove}
								onChange={(value) => setForm((current) => ({ ...current, autoApprove: value }))}
								placeholder={t("mcpStore.autoApprovePlaceholder")}
								className="h-9 rounded-xl border-border/40 bg-background/80 hover:bg-background focus-visible:bg-background focus-visible:border-primary/50 text-[13px] px-3 font-mono transition-colors"
							/>
						</div>
						<div className="col-span-2 flex items-center gap-6 pt-1">
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
			<div>
				<label className="mb-1.5 block text-[12px] font-medium text-foreground/85">
					{t("command")} <span className="text-primary/70">*</span>
				</label>
				<InputField
					aria-label={t("command")}
					value={form.command}
					onChange={(value) => setForm((current) => ({ ...current, command: value }))}
					placeholder={t("mcpStore.commandPlaceholder")}
					className="h-9 rounded-xl border-border/40 bg-background/80 hover:bg-background focus-visible:bg-background focus-visible:border-primary/50 text-[13px] px-3 font-mono transition-colors"
				/>
			</div>
			<div className="col-span-2">
				<label className="mb-1.5 block text-[12px] font-medium text-foreground/85">{t("arguments")}</label>
				<InputField
					aria-label={t("arguments")}
					value={form.args}
					onChange={(value) => setForm((current) => ({ ...current, args: value }))}
					placeholder={t("mcpStore.argsPlaceholder")}
					className="h-9 rounded-xl border-border/40 bg-background/80 hover:bg-background focus-visible:bg-background focus-visible:border-primary/50 text-[13px] px-3 font-mono transition-colors"
				/>
			</div>
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
			<div className="col-span-2">
				<label className="mb-1.5 block text-[12px] font-medium text-foreground/85">{t("envVariables")}</label>
				<TextareaField
					value={form.env}
					onChange={(value) => setForm((current) => ({ ...current, env: value }))}
					placeholder={"GITHUB_TOKEN=${GITHUB_TOKEN}\nNODE_ENV=production"}
					rows={3}
				/>
			</div>
			<div className="col-span-2">
				<label className="mb-1.5 block text-[12px] font-medium text-foreground/85">{t("workDirectory")}</label>
				<InputField
					value={form.cwd}
					onChange={(value) => setForm((current) => ({ ...current, cwd: value }))}
					placeholder="${PROJECT_ROOT}"
					className="h-9 rounded-xl border-border/40 bg-background/80 hover:bg-background focus-visible:bg-background focus-visible:border-primary/50 text-[13px] px-3 font-mono transition-colors"
				/>
			</div>
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
			<div className="col-span-2">
				<label className="mb-1.5 block text-[12px] font-medium text-foreground/85">
					{t("sseUrl")} <span className="text-primary/70">*</span>
				</label>
				<InputField
					aria-label={t("sseUrl")}
					value={form.url}
					onChange={(value) => setForm((current) => ({ ...current, url: value }))}
					placeholder={t("mcpStore.urlPlaceholder")}
					className="h-9 rounded-xl border-border/40 bg-background/80 hover:bg-background focus-visible:bg-background focus-visible:border-primary/50 text-[13px] px-3 font-mono transition-colors"
				/>
			</div>
			<label className="col-span-2 block space-y-1.5">
				<span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/85">
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
					className="h-9 rounded-xl border-border/40 bg-background/80 hover:bg-background focus-visible:bg-background focus-visible:border-primary/50 text-[13px] px-3 font-mono transition-colors"
				/>
				<span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground/75">
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
		<div className="col-span-2">
			<label className="block">
				<span className="mb-1.5 block text-[12px] font-medium text-foreground/85">{t("requestHeaders")}</span>
				<TextareaField
					value={form.headers}
					onChange={(value) => setForm((current) => ({ ...current, headers: value }))}
					placeholder={"Authorization=Bearer ${EXA_TOKEN}"}
					rows={2}
				/>
			</label>
		</div>
	);
}
