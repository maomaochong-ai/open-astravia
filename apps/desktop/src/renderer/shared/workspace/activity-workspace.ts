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

/**
 * 会话的活动工作区。
 *
 * `cwd` / `sessionId` 为空字符串时表示「还没有」，它和 null 一样不能充当 id：
 * 空 id 会被 `createActivityWorkspace` 拒绝，把整个会话页退化成错误页。
 */
export function createConversationActivityWorkspace(
	cwd: string | null,
	sessionId: string | null,
	runtimeIds: readonly string[] = [],
	fallbackId = "conversation:unbound",
): ActivityWorkspace {
	const root = cwd && cwd.length > 0 ? cwd : null;
	const session = sessionId && sessionId.length > 0 ? sessionId : null;
	return createActivityWorkspace(root ?? session ?? fallbackId, root, runtimeIds);
}
