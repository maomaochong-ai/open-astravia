import type { SelectedSkill } from "@shared/store/atoms";
import type {
	AutomationModel,
	AutomationNotifyWhen,
	AutomationRunTargetMode,
	AutomationSchedule,
	AutomationTaskInput,
	AutomationTaskPatch,
	ScheduledTask,
} from "../../../shared/automation";
import { defaultScheduleFor } from "./components/schedule-picker/automation-schedule";

/** 表单编辑态：运行会话策略与通知都拆成扁平字段，切换选项时不丢已填内容。 */
export interface AutomationDraft {
	readonly name: string;
	readonly prompt: string;
	readonly schedule: AutomationSchedule;
	readonly runMode: AutomationRunTargetMode;
	readonly projectCwd: string;
	/** 仅「同一个会话」使用；null 即「开启一个新会话」。 */
	readonly sessionPath: string | null;
	/** null 即「跟随默认模型」。 */
	readonly model: AutomationModel | null;
	readonly notifyEnabled: boolean;
	readonly webhookIds: readonly string[];
	readonly notifyWhen: AutomationNotifyWhen;
	readonly template: string;
	readonly enabled: boolean;
}

export interface AutomationDraftDefaults {
	readonly conversationCwd: string;
	readonly template: string;
	readonly now: number;
}

export function emptyAutomationDraft(defaults: AutomationDraftDefaults): AutomationDraft {
	return {
		name: "",
		prompt: "",
		schedule: defaultScheduleFor("daily", defaults.now),
		runMode: "new-session",
		projectCwd: defaults.conversationCwd,
		sessionPath: null,
		model: null,
		notifyEnabled: false,
		webhookIds: [],
		notifyWhen: "always",
		template: defaults.template,
		enabled: true,
	};
}

/** 已有任务或 agent 提交的（可能不完整的）输入 → 编辑态，缺的字段取默认值。 */
export function automationDraftFrom(
	source: Partial<AutomationTaskInput> | ScheduledTask,
	defaults: AutomationDraftDefaults,
): AutomationDraft {
	const base = emptyAutomationDraft(defaults);
	const target = source.runTarget;
	return {
		...base,
		name: source.name ?? base.name,
		prompt: source.prompt ?? base.prompt,
		schedule: source.schedule ?? base.schedule,
		runMode: target?.mode ?? base.runMode,
		projectCwd: target?.projectCwd ?? base.projectCwd,
		sessionPath: target?.mode === "same-session" ? target.sessionPath : null,
		model: source.model ?? null,
		notifyEnabled: Boolean(source.notification),
		webhookIds: source.notification?.webhookIds ?? base.webhookIds,
		notifyWhen: source.notification?.when ?? base.notifyWhen,
		template: source.notification?.template ?? base.template,
		enabled: source.enabled ?? base.enabled,
	};
}

const DERIVED_NAME_MAX = 40;

/** 标题选填：留空时取任务内容的首个非空行（去掉开头的技能 token），过长截断。 */
export function automationDraftName(draft: AutomationDraft): string {
	const name = draft.name.trim();
	if (name) return name;
	const { skill, body } = splitLeadingSkillToken(draft.prompt.trim());
	const firstLine =
		body
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find(Boolean) ??
		skill?.name ??
		"";
	const chars = Array.from(firstLine);
	return chars.length > DERIVED_NAME_MAX ? `${chars.slice(0, DERIVED_NAME_MAX).join("")}…` : firstLine;
}

export function canSubmitAutomationDraft(draft: AutomationDraft): boolean {
	if (!automationDraftName(draft) || !draft.prompt.trim() || !draft.projectCwd) return false;
	if (draft.schedule.kind === "custom" && draft.schedule.cron.trim().split(/\s+/).length !== 5) return false;
	if (draft.schedule.kind === "weekly" && draft.schedule.weekdays.length === 0) return false;
	if (draft.schedule.kind === "monthly" && draft.schedule.days.length === 0) return false;
	if (draft.notifyEnabled && (draft.webhookIds.length === 0 || !draft.template.trim())) return false;
	return true;
}

export function automationDraftToInput(draft: AutomationDraft): AutomationTaskInput {
	return {
		name: automationDraftName(draft),
		prompt: draft.prompt.trim(),
		schedule: draft.schedule,
		runTarget:
			draft.runMode === "new-session"
				? { mode: "new-session", projectCwd: draft.projectCwd }
				: { mode: "same-session", projectCwd: draft.projectCwd, sessionPath: draft.sessionPath },
		...(draft.model ? { model: draft.model } : {}),
		...(draft.notifyEnabled
			? { notification: { webhookIds: [...draft.webhookIds], when: draft.notifyWhen, template: draft.template } }
			: {}),
		enabled: draft.enabled,
	};
}

/** 编辑保存：整份提交，并显式清除被关掉的可选项。 */
export function automationDraftToPatch(draft: AutomationDraft): AutomationTaskPatch {
	const input = automationDraftToInput(draft);
	return { ...input, model: input.model ?? null, notification: input.notification ?? null };
}

// ── 任务正文开头的技能 token：表单里以技能胶囊展示，存储时还原为行内 token ──

const LEADING_TOKEN = /^@(skill|scene):(?:"([^"]*)"|(\S+))(?:\s+|$)/;

export function splitLeadingSkillToken(prompt: string): { skill: SelectedSkill | null; body: string } {
	const match = LEADING_TOKEN.exec(prompt);
	if (!match) return { skill: null, body: prompt };
	const name = match[2] ?? match[3] ?? "";
	return { skill: { name, type: match[1] as SelectedSkill["type"] }, body: prompt.slice(match[0].length) };
}

export function joinLeadingSkillToken(skill: SelectedSkill | null, body: string): string {
	if (!skill) return body;
	const name = /^[^\s"]+$/.test(skill.name) ? skill.name : `"${skill.name.replace(/"/g, "")}"`;
	return `@${skill.type}:${name} ${body}`;
}
