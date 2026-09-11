/**
 * Stable identity, filesystem root and runtime scope for an activity workspace.
 *
 * The id is an opaque host-owned key used for panel preferences and residency.
 * ActivityPanel never interprets it as a conversation, project, or team id.
 */
export interface ActivityWorkspace {
	readonly id: string;
	readonly cwd: string | null;
	/**
	 * Runtime sessions whose per-runtime activity (todo / background tasks / workflow)
	 * this workspace aggregates. An ordinary conversation contributes its single runtime;
	 * a Team contributes its coordination and member runtimes. Empty = no runtime-scoped data.
	 */
	readonly runtimeIds: readonly string[];
}

export function createActivityWorkspace(
	id: string,
	cwd: string | null,
	runtimeIds: readonly string[] = [],
): ActivityWorkspace {
	if (id.length === 0) throw new Error("Activity workspace id must not be empty");
	return { id, cwd, runtimeIds };
}
