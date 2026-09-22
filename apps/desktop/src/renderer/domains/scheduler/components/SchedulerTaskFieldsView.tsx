import { SkillPromptArea } from "@domains/conversation/components/SkillPromptArea";
import { ModelSelect } from "@shared/components/ModelSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, cn } from "@vetta-org/ui";
import type { TaskFormDialogView } from "@vetta-org/theme-ui/scheduler";
import type { ReactNode } from "react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { AutomationNotifyWhen, AutomationRunTargetMode } from "../../../../shared/automation";
import { NEW_SESSION_OPTION, type SchedulerTaskFieldsModel } from "../hooks/useSchedulerTaskFieldsModel";
import { ScheduleEditorView } from "./schedule-picker/ScheduleEditorView";

export interface SchedulerTaskFieldsViewProps extends SchedulerTaskFieldsModel {
	readonly promptMinHeight: number;
}

const RUN_MODES: readonly AutomationRunTargetMode[] = ["new-session", "same-session"];
const NOTIFY_WHEN: readonly AutomationNotifyWhen[] = ["always", "success", "failure"];

export function SchedulerTaskFieldsView({
	draft,
	namePlaceholder,
	promptBody,
	promptSkill,
	promptMinHeight,
	projectOptions,
	sessionOptions,
	sessionsLoading,
	scheduleKinds,
	scheduleSummary,
	webhooks,
	templateVariables,
	showEnabled,
	onChange,
	onPromptChange,
	onScheduleKindChange,
	onOpenWebhookSettings,
}: SchedulerTaskFieldsViewProps): JSX.Element {
	const { t } = useTranslation("automation");
	const templateRef = useRef<HTMLTextAreaElement>(null);

	const insertVariable = (key: string): void => {
		const token = `{{${key}}}`;
		const element = templateRef.current;
		const start = element?.selectionStart ?? draft.template.length;
		const end = element?.selectionEnd ?? draft.template.length;
		onChange({ template: `${draft.template.slice(0, start)}${token}${draft.template.slice(end)}` });
		requestAnimationFrame(() => {
			element?.focus();
			element?.setSelectionRange(start + token.length, start + token.length);
		});
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/20">
					<span className="icon-[mdi--clock-time-eight-outline] h-4 w-4 text-primary" />
				</div>
				<input
					type="text"
					value={draft.name}
					onChange={(event) => onChange({ name: event.target.value })}
					aria-label={t("form.name")}
					className="w-full border-none bg-transparent text-[15px] font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none! focus-visible:outline-none! focus:shadow-none! focus-visible:shadow-none!"
					placeholder={namePlaceholder}
				/>
			</div>

			<SkillPromptArea
				prompt={promptBody}
				onPromptChange={(body) => onPromptChange(body, promptSkill)}
				skill={promptSkill}
				onSkillChange={(skill) => onPromptChange(promptBody, skill)}
				placeholder={t("form.promptPlaceholder")}
				minHeight={promptMinHeight}
				cwd={draft.projectCwd}
			/>

			<div className="space-y-3 rounded-lg border border-border/40 bg-background/30 p-3">
				<FieldRow label={t("form.runTarget")}>
					<Segmented
						options={RUN_MODES.map((mode) => ({ value: mode, label: t(`form.runMode.${mode}`) }))}
						value={draft.runMode}
						onChange={(runMode) => onChange({ runMode })}
					/>
				</FieldRow>

				<FieldRow label={t("form.project")}>
					<OptionSelect
						ariaLabel={t("form.project")}
						options={projectOptions}
						value={draft.projectCwd}
						onChange={(projectCwd) => onChange({ projectCwd })}
					/>
				</FieldRow>

				{draft.runMode === "same-session" && (
					<FieldRow label={t("form.session")} hint={t("form.sessionHint")}>
						<OptionSelect
							ariaLabel={t("form.session")}
							options={sessionOptions}
							value={draft.sessionPath ?? NEW_SESSION_OPTION}
							disabled={sessionsLoading}
							onChange={(sessionPath) => onChange({ sessionPath: sessionPath === NEW_SESSION_OPTION ? null : sessionPath })}
						/>
					</FieldRow>
				)}

				<FieldRow label={t("form.model")}>
					<ModelSelect
						value={draft.model?.key ?? null}
						allowClear
						autoSelectDefault={false}
						placeholder={t("form.modelFollowDefault")}
						onChange={(key) =>
							onChange({
								model: key ? { key, ...(draft.model?.key === key && draft.model.reasoning ? { reasoning: draft.model.reasoning } : {}) } : null,
							})
						}
						reasoning={
							draft.model
								? {
										value: draft.model.reasoning,
										onChange: (reasoning) => draft.model && onChange({ model: { key: draft.model.key, reasoning } }),
									}
								: undefined
						}
						triggerClassName="h-8 rounded-lg border-border/50 bg-card/40 px-2.5 text-muted-foreground hover:border-primary/30 hover:bg-card/70 hover:text-foreground"
					/>
				</FieldRow>

				<FieldRow label={t("form.repeat")} hint={scheduleSummary}>
					<ScheduleEditorView
						kinds={scheduleKinds}
						schedule={draft.schedule}
						onKindChange={onScheduleKindChange}
						onChange={(schedule) => onChange({ schedule })}
					/>
				</FieldRow>

				<FieldRow label={t("form.notify")}>
					<Switch
						checked={draft.notifyEnabled}
						aria-label={t("form.notify")}
						onCheckedChange={(notifyEnabled) => onChange({ notifyEnabled })}
					/>
				</FieldRow>

				{draft.notifyEnabled && (
					<div className="space-y-3 rounded-md bg-card/40 p-3">
						<FieldRow label={t("form.notifyEndpoints")}>
							{webhooks.length === 0 ? (
								<button
									type="button"
									onClick={onOpenWebhookSettings}
									className="text-[12px] text-primary hover:underline"
								>
									{t("form.notifyGoSettings")}
								</button>
							) : (
								<div className="flex flex-wrap gap-1.5">
									{webhooks.map((webhook) => {
										const selected = draft.webhookIds.includes(webhook.id);
										return (
											<button
												key={webhook.id}
												type="button"
												aria-pressed={selected}
												title={webhook.enabled ? undefined : t("form.notifyEndpointDisabled")}
												onClick={() =>
													onChange({
														webhookIds: selected
															? draft.webhookIds.filter((id) => id !== webhook.id)
															: [...draft.webhookIds, webhook.id],
													})
												}
												className={cn(
													"flex h-7 items-center gap-1 rounded-md border px-2 text-[12px] transition-colors",
													selected
														? "border-primary/40 bg-primary/10 text-primary"
														: "border-border/50 text-muted-foreground hover:text-foreground",
													!webhook.enabled && "opacity-50",
												)}
											>
												<span className="icon-[mdi--webhook] h-3.5 w-3.5" />
												{webhook.name}
											</button>
										);
									})}
								</div>
							)}
						</FieldRow>
						<FieldRow label={t("form.notifyWhen")}>
							<Segmented
								options={NOTIFY_WHEN.map((when) => ({ value: when, label: t(`form.notifyWhenOption.${when}`) }))}
								value={draft.notifyWhen}
								onChange={(notifyWhen) => onChange({ notifyWhen })}
							/>
						</FieldRow>
						<div className="space-y-1.5">
							<div className="flex flex-wrap items-center gap-1">
								<span className="mr-1 text-[12px] text-muted-foreground">{t("form.notifyTemplate")}</span>
								{templateVariables.map((variable) => (
									<button
										key={variable.key}
										type="button"
										onClick={() => insertVariable(variable.key)}
										className="h-6 rounded-md bg-accent/50 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
									>
										{variable.label}
									</button>
								))}
							</div>
							<textarea
								ref={templateRef}
								value={draft.template}
								rows={4}
								aria-label={t("form.notifyTemplate")}
								onChange={(event) => onChange({ template: event.target.value })}
								className="w-full resize-y rounded-md border border-border/50 bg-background/60 px-2.5 py-2 font-mono text-[12px] text-foreground focus:outline-none"
							/>
						</div>
					</div>
				)}

				{showEnabled && (
					<FieldRow label={t("form.enabledLabel")}>
						<Switch
							checked={draft.enabled}
							aria-label={t("form.enabledLabel")}
							onCheckedChange={(enabled) => onChange({ enabled })}
						/>
					</FieldRow>
				)}
			</div>
		</div>
	);
}

function FieldRow({
	label,
	hint,
	children,
}: {
	readonly label: string;
	readonly hint?: string;
	readonly children: ReactNode;
}): JSX.Element {
	return (
		<div className="flex min-w-0 items-start gap-3">
			<div className="w-20 shrink-0 pt-1.5 text-[12px] text-muted-foreground">{label}</div>
			<div className="min-w-0 flex-1 space-y-1">
				{children}
				{hint && <p className="text-[11px] text-muted-foreground/60">{hint}</p>}
			</div>
		</div>
	);
}

export function Segmented<Value extends string>({
	options,
	value,
	onChange,
}: {
	readonly options: readonly { readonly value: Value; readonly label: string }[];
	readonly value: Value;
	readonly onChange: (value: Value) => void;
}): JSX.Element {
	return (
		<div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted/50 p-0.5">
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					aria-pressed={option.value === value}
					onClick={() => onChange(option.value)}
					className={cn(
						"h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors",
						option.value === value
							? "bg-card text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

function OptionSelect({
	ariaLabel,
	options,
	value,
	disabled,
	onChange,
}: {
	readonly ariaLabel: string;
	readonly options: readonly { readonly value: string; readonly label: string }[];
	readonly value: string;
	readonly disabled?: boolean;
	readonly onChange: (value: string) => void;
}): JSX.Element {
	// Radix Select 不接受空串作为 item value：内部映射成占位符再换回来。
	const encode = (raw: string): string => (raw === "" ? "__empty__" : raw);
	const decode = (encoded: string): string => (encoded === "__empty__" ? "" : encoded);
	return (
		<Select value={encode(value)} onValueChange={(next) => onChange(decode(next))} disabled={disabled}>
			<SelectTrigger aria-label={ariaLabel} className="h-8 max-w-full min-w-[180px]">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.value} value={encode(option.value)}>
						<span className="block max-w-[320px] truncate">{option.label}</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export type ThemeUiLink_TaskFormDialogView = typeof TaskFormDialogView;
