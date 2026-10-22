/**
 * 目标受阻 / 中断的原因由运行时以英文原文给出（`goal-runtime.ts`、
 * `desktop-goal-controller.ts`），界面不能直接把它当文案渲染。这里把它们映射到
 * i18n 键，未登记的原文（用户或模型经 goal 工具写下的自定义说明）原样回落。
 *
 * 这是纯展示层映射：运行时改了措辞，最坏结果是回落到英文原文，不会影响行为。
 * `goal-status-detail.test.ts` 用运行时真实产出的句子锁住这几条。
 */
export type GoalStatusDetailKey =
	| "goalMode.statusDetail.executionFailed"
	| "goalMode.statusDetail.noProgress"
	| "goalMode.statusDetail.restored"
	| "goalMode.statusDetail.sessionResumeFailed"
	| "goalMode.statusDetail.sessionStartFailed";

const KEY_BY_DETAIL: Readonly<Record<string, GoalStatusDetailKey>> = {
	"Restored after the session stopped; resume explicitly to continue": "goalMode.statusDetail.restored",
	"Execution failed for three consecutive goal turns; review the failure before resuming":
		"goalMode.statusDetail.executionFailed",
	"No observable progress was produced for three consecutive goal continuations; review the goal before resuming":
		"goalMode.statusDetail.noProgress",
	"The session could not start": "goalMode.statusDetail.sessionStartFailed",
	"The session could not resume": "goalMode.statusDetail.sessionResumeFailed",
};

/** 已知原因返回 i18n 键，未知返回 undefined，由调用方回落到原文。 */
export function goalStatusDetailKey(detail: string | undefined): GoalStatusDetailKey | undefined {
	const trimmed = detail?.trim();
	if (!trimmed) return undefined;
	return KEY_BY_DETAIL[trimmed];
}
