/**
 * Stable identity and filesystem root for an activity workspace.
 *
 * The id is an opaque host-owned key used for panel preferences and residency.
 * ActivityPanel never interprets it as a conversation, project, or team id.
 */
export interface ActivityWorkspace {
	readonly id: string;
	readonly cwd: string | null;
}

export function createActivityWorkspace(id: string, cwd: string | null): ActivityWorkspace {
	if (id.length === 0) throw new Error("Activity workspace id must not be empty");
	return { id, cwd };
}
