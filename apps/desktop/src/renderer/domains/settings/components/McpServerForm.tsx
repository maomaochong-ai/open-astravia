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
		<>
			<McpServerFields form={form} setForm={setForm} />

			<div className="mt-5 flex justify-end gap-2 border-t border-border/50 pt-4">
				<Button variant="ghost" size="sm" onClick={onCancel}>
					{t("cancel")}
				</Button>
				<Button variant="primary" size="sm" onClick={onSave} disabled={!isMcpFormValid(form) || saving}>
					{saveLabel}
				</Button>
			</div>
		</>
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
		<>
			<div className="rounded-xl border border-border/50 bg-muted/30 p-4">
				<label className="mb-1 block text-[11px] text-muted-foreground">{t("transportType")}</label>
				<SegmentedControl
					items={[
						{ key: "stdio" as McpTransportType, label: t("stdio") },
						{ key: "http" as McpTransportType, label: "HTTP" },
					]}
					value={form.transport}
					onChange={(transport) => setForm((current) => ({ ...current, transport }))}
				/>
			</div>
			<div className="mt-4 grid grid-cols-2 gap-4">
				<div className={form.transport === "http" ? "col-span-2" : undefined}>
					<label className="mb-1 block text-[11px] text-muted-foreground">{t("serverName")} *</label>
					<InputField
						aria-label={t("serverName")}
						value={form.name}
						onChange={(value) => setForm((current) => ({ ...current, name: value }))}
						placeholder={t("mcpStore.namePlaceholder")}
					/>
				</div>
				{form.transport === "stdio" ? (
					<StdioBasicFields form={form} setForm={setForm} />
				) : (
					<HttpBasicFields form={form} setForm={setForm} />
				)}
			</div>

			<div className="mt-5 border-t border-border/50 pt-4">
				<button
					type="button"
					aria-expanded={advancedOpen}
					onClick={() => setAdvancedOpen((open) => !open)}
					className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
				>
					<span
						className={cn(
							"icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 transition-transform",
							advancedOpen && "rotate-90",
						)}
					/>
					{t("advancedOptions")}
				</button>

				{advancedOpen && (
					<div className="mt-3 grid grid-cols-2 gap-3 border-t border-border/50 pt-3">
						{form.transport === "stdio" ? (
							<StdioAdvancedFields form={form} setForm={setForm} />
						) : (
							<HttpAdvancedFields form={form} setForm={setForm} />
						)}
						<div>
							<label className="mb-1 block text-[11px] text-muted-foreground">{t("startupTimeout")}</label>
							<InputField
								value={form.startupTimeout}
								onChange={(value) => setForm((current) => ({ ...current, startupTimeout: value }))}
								placeholder={t("default10000")}
							/>
						</div>
						<div className="col-span-2">
							<label className="mb-1 block text-[11px] text-muted-foreground">{t("autoApproveTools")}</label>
							<InputField
								value={form.autoApprove}
								onChange={(value) => setForm((current) => ({ ...current, autoApprove: value }))}
								placeholder={t("mcpStore.autoApprovePlaceholder")}
							/>
						</div>
						<div className="col-span-2 flex items-center gap-6">
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
		</>
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
				<label className="mb-1 block text-[11px] text-muted-foreground">{t("command")} *</label>
				<InputField
					aria-label={t("command")}
					value={form.command}
					onChange={(value) => setForm((current) => ({ ...current, command: value }))}
					placeholder={t("mcpStore.commandPlaceholder")}
				/>
			</div>
			<div className="col-span-2">
				<label className="mb-1 block text-[11px] text-muted-foreground">{t("arguments")}</label>
				<InputField
					aria-label={t("arguments")}
					value={form.args}
					onChange={(value) => setForm((current) => ({ ...current, args: value }))}
					placeholder={t("mcpStore.argsPlaceholder")}
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
				<label className="mb-1 block text-[11px] text-muted-foreground">{t("envVariables")}</label>
				<TextareaField
					value={form.env}
					onChange={(value) => setForm((current) => ({ ...current, env: value }))}
					placeholder={"GITHUB_TOKEN=${GITHUB_TOKEN}\nNODE_ENV=production"}
					rows={3}
				/>
			</div>
			<div className="col-span-2">
				<label className="mb-1 block text-[11px] text-muted-foreground">{t("workDirectory")}</label>
				<InputField
					value={form.cwd}
					onChange={(value) => setForm((current) => ({ ...current, cwd: value }))}
					placeholder="${PROJECT_ROOT}"
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
				<label className="mb-1 block text-[11px] text-muted-foreground">{t("sseUrl")} *</label>
				<InputField
					aria-label={t("sseUrl")}
					value={form.url}
					onChange={(value) => setForm((current) => ({ ...current, url: value }))}
					placeholder={t("mcpStore.urlPlaceholder")}
				/>
			</div>
			<label className="col-span-2 block">
				<span className="mb-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
					<span className="icon-[solar--key-minimalistic-square-linear] h-3.5 w-3.5" aria-hidden="true" />
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
				/>
				<span className="mt-1.5 block text-[11px] leading-relaxed text-muted-foreground/70">
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
				<span className="mb-1 block text-[11px] text-muted-foreground">{t("requestHeaders")}</span>
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
