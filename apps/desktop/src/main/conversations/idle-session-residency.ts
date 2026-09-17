/**
 * 交互式会话在主进程的驻留策略。
 *
 * 打开过的 Runtime 默认会一直留在 RuntimeHost 里，切走也不释放。这里只约束
 * **空闲**交互式会话的数量：正在跑的会话全部保留，最近用过的空闲会话保留一
 * 小段热窗口，方便立刻切回去；更早的空闲会话走已有 dispose 路径，再打开时
 * 仍由 session.create 恢复。
 *
 * 不回收正在跑的会话，也不在每次切换时立刻 dispose，避免打断后台回合或打回
 * 已有会话的热恢复。
 */
export const IDLE_RESIDENT_SESSION_LIMIT = 3;

export interface InteractiveSessionResidency {
	readonly sessionId: string;
	readonly lastUsedAt: number;
	readonly running: boolean;
}

export function selectIdleSessionsToEvict(
	sessions: readonly InteractiveSessionResidency[],
	idleLimit: number = IDLE_RESIDENT_SESSION_LIMIT,
): string[] {
	if (idleLimit < 0) throw new Error("idle session residency limit must be >= 0");
	const idle = sessions.filter((session) => !session.running);
	if (idle.length <= idleLimit) return [];
	return [...idle]
		.sort((left, right) => {
			const byRecency = right.lastUsedAt - left.lastUsedAt;
			if (byRecency !== 0) return byRecency;
			return left.sessionId.localeCompare(right.sessionId);
		})
		.slice(idleLimit)
		.map((session) => session.sessionId);
}

export class InteractiveSessionResidencyTracker {
	private readonly lastUsedAt = new Map<string, number>();
	private nextUsedAt = 0;

	touch(sessionId: string, at?: number): void {
		let value: number;
		if (at === undefined) {
			this.nextUsedAt += 1;
			value = this.nextUsedAt;
		} else {
			value = at;
			if (value >= this.nextUsedAt) this.nextUsedAt = value;
		}
		this.lastUsedAt.set(sessionId, value);
	}

	forget(sessionId: string): void {
		this.lastUsedAt.delete(sessionId);
	}

	has(sessionId: string): boolean {
		return this.lastUsedAt.has(sessionId);
	}

	trackedIds(): string[] {
		return [...this.lastUsedAt.keys()];
	}

	idsToEvict(runningIds: ReadonlySet<string>, idleLimit: number = IDLE_RESIDENT_SESSION_LIMIT): string[] {
		return selectIdleSessionsToEvict(this.snapshot(runningIds), idleLimit);
	}

	private snapshot(runningIds: ReadonlySet<string>): InteractiveSessionResidency[] {
		return [...this.lastUsedAt.entries()].map(([sessionId, lastUsedAt]) => ({
			sessionId,
			lastUsedAt,
			running: runningIds.has(sessionId),
		}));
	}
}

export function collectRunningInteractiveSessionIds(
	trackedIds: readonly string[],
	getSessionPath: (sessionId: string) => string | undefined,
	runningPaths: readonly string[],
): Set<string> {
	const running = new Set(runningPaths);
	const ids = new Set<string>();
	for (const sessionId of trackedIds) {
		const sessionPath = getSessionPath(sessionId);
		if (sessionPath && running.has(sessionPath)) ids.add(sessionId);
	}
	return ids;
}

export async function reconcileIdleInteractiveSessions(input: {
	readonly tracker: InteractiveSessionResidencyTracker;
	readonly runningIds: ReadonlySet<string>;
	readonly dispose: (sessionId: string) => Promise<void>;
	readonly onDisposeError?: (sessionId: string, error: unknown) => void;
}): Promise<readonly string[]> {
	const evicted: string[] = [];
	for (const sessionId of input.tracker.idsToEvict(input.runningIds)) {
		try {
			await input.dispose(sessionId);
			evicted.push(sessionId);
		} catch (error) {
			input.onDisposeError?.(sessionId, error);
		}
	}
	return evicted;
}
