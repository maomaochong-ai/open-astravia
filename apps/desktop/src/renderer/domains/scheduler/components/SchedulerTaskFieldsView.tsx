import { SkillPromptArea } from "@domains/conversation/components/SkillPromptArea";
import { ModelSelect } from "@shared/components/ModelSelect";
import { cn, Switch } from "@vetta-org/ui";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { AutomationNotifyWhen, AutomationRunTargetMode } from "../../../../shared/automation";
import { NEW_SESSION_OPTION, type SchedulerTaskFieldsModel } from "../hooks/useSchedulerTaskFieldsModel";
import { FieldGroup, FieldRow, RowSelect } from "./AutomationFieldRows";
import { ScheduleEditorView } from "./schedule-picker/ScheduleEditorView";

export interface SchedulerTaskFieldsViewProps extends SchedulerTaskFieldsModel {
	readonly promptMinHeight: number;
}

const RUN_MODES: readonly AutomationRunTargetMode[] = ["new-session", "same-session"];
const NOTIFY_WHEN: readonly AutomationNotifyWhen[] = ["always", "success", "failure"];

/** 自动化的编辑内容：标题、任务正文，其下按「详情 / 频率 / 通知」分组成设置行。 */
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
		<div className="space-y-5">
			<input
				type="text"
				value={draft.name}
				onChange={(event) => onChange({ name: event.target.value })}
				aria-label={t("form.name")}
				className="w-full border-none bg-transparent text-[18px] font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none! focus-visible:outline-none! focus:shadow-none! focus-visible:shadow-none!"
				placeholder={namePlaceholder}
			/>

			<SkillPromptArea
				prompt={promptBody}
				onPromptChange={(body) => onPromptChange(body, promptSkill)}
				skill={promptSkill}
				onSkillChange={(skill) => onPromptChange(promptBody, skill)}
				placeholder={t("form.promptPlaceholder")}
				minHeight={promptMinHeight}
				cwd={draft.projectCwd}
			/>

			<FieldGroup title={t("form.sectionDetails")}>
				<FieldRow label={t("form.runTarget")}>
					<RowSelect
						ariaLabel={t("form.runTarget")}
						options={RUN_MODES.map((mode) => ({ value: mode, label: t(`form.runMode.${mode}`) }))}
						value={draft.runMode}
						onChange={(runMode) => onChange({ runMode: runMode as AutomationRunTargetMode })}
					/>
				</FieldRow>
				<FieldRow label={t("form.project")}>
					<RowSelect
						ariaLabel={t("form.project")}
						options={projectOptions}
						value={draft.projectCwd}
						onChange={(projectCwd) => onChange({ projectCwd })}
					/>
				</FieldRow>
				{draft.runMode === "same-session" && (
					<FieldRow label={t("form.session")} hint={t("form.sessionHint")}>
						<RowSelect
							ariaLabel={t("form.session")}
							options={sessionOptions}
							value={draft.sessionPath ?? NEW_SESSION_OPTION}
							disabled={sessionsLoading}
							onChange={(sessionPath) =>
								onChange({ sessionPath: sessionPath === NEW_SESSION_OPTION ? null : sessionPath })
							}
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
								model: key
									? {
											key,
											...(draft.model?.key === key && draft.model.reasoning
												? { reasoning: draft.model.reasoning }
												: {}),
										}
									: null,
							})
						}
						reasoning={
							draft.model
								? {
										value: draft.model.reasoning,
										onChange: (reasoning) =>
											draft.model && onChange({ model: { key: draft.model.key, reasoning } }),
									}
								: undefined
						}
						triggerClassName="h-7 border-transparent bg-transparent px-2 text-muted-foreground hover:bg-accent"
					/>
				</FieldRow>
				{showEnabled && (
					<FieldRow label={t("form.enabledLabel")}>
						<Switch
							checked={draft.enabled}
							aria-label={t("form.enabledLabel")}
							onCheckedChange={(enabled) => onChange({ enabled })}
						/>
					</FieldRow>
				)}
			</FieldGroup>

			<FieldGroup title={t("form.sectionFrequency")}>
				<ScheduleEditorView
					kinds={scheduleKinds}
					schedule={draft.schedule}
					summary={scheduleSummary}
					onKindChange={onScheduleKindChange}
					onChange={(schedule) => onChange({ schedule })}
				/>
			</FieldGroup>

			<FieldGroup title={t("form.sectionNotify")}>
				<FieldRow label={t("form.notify")}>
					<Switch
						checked={draft.notifyEnabled}
						aria-label={t("form.notify")}
						onCheckedChange={(notifyEnabled) => onChange({ notifyEnabled })}
					/>
				</FieldRow>
				{draft.notifyEnabled && (
					<>
						<FieldRow label={t("form.notifyEndpoints")} stacked={webhooks.length > 0}>
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
							<RowSelect
								ariaLabel={t("form.notifyWhen")}
								options={NOTIFY_WHEN.map((when) => ({ value: when, label: t(`form.notifyWhenOption.${when}`) }))}
								value={draft.notifyWhen}
								onChange={(notifyWhen) => onChange({ notifyWhen: notifyWhen as AutomationNotifyWhen })}
							/>
						</FieldRow>
						<FieldRow label={t("form.notifyTemplate")} stacked>
							<div className="space-y-1.5">
								<div className="flex flex-wrap items-center gap-1">
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
						</FieldRow>
					</>
				)}
			</FieldGroup>
		</div>
	);
}
