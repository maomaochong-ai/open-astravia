import { defaultConversationCwdAtom, projectsAtom, type SelectedSkill } from "@shared/store/atoms";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AutomationScheduleKind, AutomationTemplateVariable } from "../../../../shared/automation";
import { AUTOMATION_TEMPLATE_VARIABLES } from "../../../../shared/automation";
import { type AutomationDraft, joinLeadingSkillToken, splitLeadingSkillToken } from "../automation-draft";
import { defaultScheduleFor, SCHEDULE_KINDS } from "../components/schedule-picker/automation-schedule";
import { describeSchedule } from "../components/schedule-picker/describe-schedule";

export interface AutomationOption {
	readonly value: string;
	readonly label: string;
}

export interface AutomationWebhookOption {
	readonly id: string;
	readonly name: string;
	readonly enabled: boolean;
}

export interface SchedulerTaskFieldsModel {
	readonly draft: AutomationDraft;
	readonly namePlaceholder: string;
	readonly promptBody: string;
	readonly promptSkill: SelectedSkill | null;
	readonly projectOptions: readonly AutomationOption[];
	/** 「同一个会话」可选的会话；首项固定是「开启一个新会话」。 */
	readonly sessionOptions: readonly AutomationOption[];
	readonly sessionsLoading: boolean;
	readonly scheduleKinds: readonly { readonly kind: AutomationScheduleKind; readonly label: string }[];
	readonly scheduleSummary: string;
	readonly webhooks: readonly AutomationWebhookOption[];
	readonly templateVariables: readonly { readonly key: AutomationTemplateVariable; readonly label: string }[];
	readonly showEnabled: boolean;
	readonly onChange: (patch: Partial<AutomationDraft>) => void;
	readonly onPromptChange: (body: string, skill: SelectedSkill | null) => void;
	readonly onScheduleKindChange: (kind: AutomationScheduleKind) => void;
	readonly onOpenWebhookSettings: () => void;
}

/** 「开启一个新会话」在下拉里的取值；真实会话路径不会是空串。 */
export const NEW_SESSION_OPTION = "";

interface UseSchedulerTaskFieldsModelOptions {
	readonly value: AutomationDraft;
	readonly onChange: (value: AutomationDraft) => void;
	readonly namePlaceholder: string | undefined;
	readonly showEnabled: boolean;
}

export function useSchedulerTaskFieldsModel({
	value,
	onChange,
	namePlaceholder,
	showEnabled,
}: UseSchedulerTaskFieldsModelOptions): SchedulerTaskFieldsModel {
	const { t } = useTranslation("automation");
	const navigate = useNavigate();
	const projects = useAtomValue(projectsAtom);
	const conversationCwd = useAtomValue(defaultConversationCwdAtom);
	const [sessions, setSessions] = useState<readonly AutomationOption[]>([]);
	const [sessionsLoading, setSessionsLoading] = useState(false);
	const [webhooks, setWebhooks] = useState<readonly AutomationWebhookOption[]>([]);

	const sameSession = value.runMode === "same-session";
	const { projectCwd } = value;
	useEffect(() => {
		if (!sameSession || !projectCwd) {
			setSessions([]);
			return;
		}
		let cancelled = false;
		setSessionsLoading(true);
		void window.vetta.session
			.listSessions(projectCwd)
			.then((listed) => {
				if (cancelled) return;
				setSessions(
					listed
						.filter((session) => session.access.resume)
						.sort((a, b) => b.modifiedAt - a.modifiedAt)
						.map((session) => ({
							value: session.path,
							label: session.name?.trim() || session.firstMessage.trim() || session.id,
						})),
				);
			})
			.catch(() => {
				if (!cancelled) setSessions([]);
			})
			.finally(() => {
				if (!cancelled) setSessionsLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [projectCwd, sameSession]);

	useEffect(() => {
		void window.vetta.webhook
			.list()
			.then((endpoints) =>
				setWebhooks(
					endpoints.map((endpoint) => ({ id: endpoint.id, name: endpoint.name, enabled: endpoint.enabled })),
				),
			)
			.catch(() => setWebhooks([]));
	}, []);

	return useMemo(() => {
		const { skill, body } = splitLeadingSkillToken(value.prompt);
		const projectOptions: AutomationOption[] = [];
		const seen = new Set<string>();
		const addProject = (cwd: string | undefined, label: string): void => {
			if (!cwd || seen.has(cwd)) return;
			seen.add(cwd);
			projectOptions.push({ value: cwd, label });
		};
		addProject(conversationCwd, t("form.projectNone"));
		for (const project of projects) addProject(project.cwd, project.name ?? project.cwd);
		// 编辑的任务指向已移除的项目时仍显示出来，让用户看清并改选。
		addProject(value.projectCwd, value.projectCwd);

		const sessionOptions: AutomationOption[] = [{ value: NEW_SESSION_OPTION, label: t("form.sessionNew") }];
		for (const session of sessions) sessionOptions.push(session);
		if (value.sessionPath && !sessions.some((session) => session.value === value.sessionPath) && !sessionsLoading) {
			sessionOptions.push({ value: value.sessionPath, label: t("form.sessionMissing") });
		}

		return {
			draft: value,
			namePlaceholder: namePlaceholder ?? t("form.namePlaceholder"),
			promptBody: body,
			promptSkill: skill,
			projectOptions,
			sessionOptions,
			sessionsLoading,
			scheduleKinds: SCHEDULE_KINDS.map((kind) => ({ kind, label: t(`scheduleMode.${kind}`) })),
			scheduleSummary: describeSchedule(value.schedule, t),
			webhooks,
			templateVariables: AUTOMATION_TEMPLATE_VARIABLES.map((key) => ({ key, label: t(`form.variables.${key}`) })),
			showEnabled,
			onChange: (patch) => {
				const next = { ...value, ...patch };
				// 换项目后原来选的会话不再属于它，回到「开启一个新会话」。
				if (patch.projectCwd !== undefined && patch.projectCwd !== value.projectCwd) {
					onChange({ ...next, sessionPath: null });
					return;
				}
				onChange(next);
			},
			onPromptChange: (nextBody, nextSkill) =>
				onChange({ ...value, prompt: joinLeadingSkillToken(nextSkill, nextBody) }),
			onScheduleKindChange: (kind) => {
				if (kind === value.schedule.kind) return;
				onChange({ ...value, schedule: defaultScheduleFor(kind, Date.now(), value.schedule) });
			},
			onOpenWebhookSettings: () => {
				void navigate({ to: "/settings/$tab", params: { tab: "webhook" }, search: {} });
			},
		};
	}, [
		conversationCwd,
		namePlaceholder,
		navigate,
		onChange,
		projects,
		sessions,
		sessionsLoading,
		showEnabled,
		t,
		value,
		webhooks,
	]);
}
