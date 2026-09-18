export interface TeamMemberModelSelection {
	readonly modelKey: string;
	readonly reasoning?: string;
}

export interface TeamMemberModelPreference extends TeamMemberModelSelection {
	readonly agentProfileId: string;
}
