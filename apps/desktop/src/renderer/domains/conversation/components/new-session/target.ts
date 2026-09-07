export type NewSessionTargetKey = string & { readonly __newSessionTargetKey: unique symbol };

export const CONVERSATION_TARGET_KEY = "conversation" as NewSessionTargetKey;

export function teamTargetKey(teamId: string): NewSessionTargetKey {
	return `team:${teamId}` as NewSessionTargetKey;
}

export function parseTeamTargetKey(value: string | null | undefined): string | null {
	if (!value?.startsWith("team:")) return null;
	const id = value.slice("team:".length).trim();
	return id.length > 0 ? id : null;
}

export function agentTargetKey(agentProfileId: string): NewSessionTargetKey {
	return `agent:${agentProfileId}` as NewSessionTargetKey;
}

export function parseAgentTargetKey(value: string | null | undefined): string | null {
	if (!value?.startsWith("agent:")) return null;
	const id = value.slice("agent:".length).trim();
	return id.length > 0 ? id : null;
}

/**
 * 单个 Agent 走的是普通会话链路（人格与能力由主进程按身份裁剪），只有团队才需要
 * Team 编排与专用编辑器。因此凡是「要不要按团队处理」的判断都必须问这个，
 * 而不是问「有没有选中 target」。
 */
export function isTeamTarget(value: string | null | undefined): boolean {
	return parseTeamTargetKey(value) !== null;
}

export function parseNewSessionTarget(value: string | null | undefined): NewSessionTargetKey {
	if (!value || value === CONVERSATION_TARGET_KEY) return CONVERSATION_TARGET_KEY;
	return value as NewSessionTargetKey;
}

export interface NewSessionTargetOption {
	readonly targetKey: NewSessionTargetKey;
	readonly title: string;
	readonly subtitle?: string;
	readonly avatarUrls?: readonly string[];
	readonly selected: boolean;
	readonly disabled?: boolean;
}

export function filterTargetOptions(
	options: readonly NewSessionTargetOption[],
	query: string,
): readonly NewSessionTargetOption[] {
	const normalized = query.trim().toLocaleLowerCase();
	if (!normalized) return options;
	return options.filter((option) =>
		`${option.title} ${option.subtitle ?? ""}`.toLocaleLowerCase().includes(normalized),
	);
}

export function targetDraftScope(target: NewSessionTargetKey, contextCwd: string): string {
	return target === CONVERSATION_TARGET_KEY ? `new:${contextCwd}` : `new-target:${target}`;
}
