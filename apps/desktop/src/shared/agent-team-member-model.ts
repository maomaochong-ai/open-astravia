export interface TeamMemberModelSelection {
	readonly modelKey: string;
	readonly reasoning?: string;
}

export interface TeamMemberModelPreference extends TeamMemberModelSelection {
	readonly agentProfileId: string;
}

export function resolveTeamMemberModel(input: {
	readonly modelKey?: string;
	readonly reasoning?: string;
	readonly sessionModelKey?: string;
	readonly sessionReasoning?: string;
	readonly agentProfileId?: string;
	readonly preference?: TeamMemberModelPreference;
}): { readonly modelKey?: string; readonly reasoning?: string } {
	const pinned = input.preference?.agentProfileId === input.agentProfileId ? input.preference : undefined;
	if (pinned) return { modelKey: pinned.modelKey, reasoning: pinned.reasoning };
	const modelKey = input.modelKey ?? input.sessionModelKey;
	const reasoning = input.reasoning ?? (input.modelKey === undefined ? input.sessionReasoning : undefined);
	return { modelKey, reasoning };
}
