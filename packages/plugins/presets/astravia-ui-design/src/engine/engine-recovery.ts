/** 单份设计在时间窗口内允许的自动重启次数；再多通常是持续性构建/宿主故障。 */
export const ENGINE_RESTART_LIMIT = 3;
/** 稳定运行超过这个窗口后，旧的异常退出不再计入熔断。 */
export const ENGINE_RESTART_WINDOW_MS = 60_000;
const ENGINE_RESTART_BASE_DELAY_MS = 250;

export type EngineRestartDecision =
	| {
			kind: "restart";
			history: readonly number[];
			attempt: number;
			maxAttempts: number;
			delayMs: number;
	  }
	| {
			kind: "exhausted";
			history: readonly number[];
			attempts: number;
			maxAttempts: number;
	  };

/**
 * 为设计引擎的异常退出制定有限重启计划。
 *
 * 时间戳由调用方持有，函数本身无定时器和 React 状态，避免恢复规则散落在 Canvas
 * effect 的异步分支里，也让退避、熔断与稳定窗口可以用确定时间测试。
 */
export function planEngineRestart(
	history: readonly number[],
	now = Date.now(),
): EngineRestartDecision {
	const recent = history.filter((timestamp) => now - timestamp <= ENGINE_RESTART_WINDOW_MS);
	const nextHistory = [...recent, now];
	const attempt = nextHistory.length;
	if (attempt > ENGINE_RESTART_LIMIT) {
		return {
			kind: "exhausted",
			history: nextHistory,
			attempts: attempt,
			maxAttempts: ENGINE_RESTART_LIMIT,
		};
	}
	return {
		kind: "restart",
		history: nextHistory,
		attempt,
		maxAttempts: ENGINE_RESTART_LIMIT,
		delayMs: ENGINE_RESTART_BASE_DELAY_MS * 2 ** (attempt - 1),
	};
}
