import type { SubagentSnapshot } from "@vetta/runtime-subagents";
import type {
	CodingAgentSubagentSnapshot,
	CodingAgentSubagentTodoProgress,
	CodingAgentWorkflowDispatchRequest,
} from "../../runtime-contracts/index.js";

/**
 * Todo 子代理投影的唯一状态所有者。
 *
 * 调度器只维护 Subagent 生命周期；该产品投影通过稳定 taskName 关联 queued 临时身份、
 * Child Session 真正身份和恢复后的快照。
 */
export class CodingAgentSubagentTodoProjection {
	private readonly progressByTaskName = new Map<string, CodingAgentSubagentTodoProgress>();
	private readonly initialItemsByTaskName = new Map<string, readonly string[]>();

	seed(requests: readonly CodingAgentWorkflowDispatchRequest[]): CodingAgentSubagentTodoProjectionSeed {
		const previous = requests.map(({ taskName }) => ({
			taskName,
			initialItems: this.initialItemsByTaskName.get(taskName),
			progress: this.progressByTaskName.get(taskName),
		}));
		for (const request of requests) {
			const items = [...request.todos];
			this.initialItemsByTaskName.set(request.taskName, items);
			this.progressByTaskName.set(request.taskName, { done: 0, total: items.length });
		}
		return { previous };
	}

	rollback(seed: CodingAgentSubagentTodoProjectionSeed): void {
		for (const entry of seed.previous) {
			restoreMapEntry(this.initialItemsByTaskName, entry.taskName, entry.initialItems);
			restoreMapEntry(this.progressByTaskName, entry.taskName, entry.progress);
		}
	}

	readInitialItems(taskName: string): readonly string[] | undefined {
		const items = this.initialItemsByTaskName.get(taskName);
		return items ? [...items] : undefined;
	}

	restore(snapshot: CodingAgentSubagentSnapshot): void {
		if (snapshot.todoProgress) {
			this.progressByTaskName.set(snapshot.taskName, { ...snapshot.todoProgress });
		}
	}

	update(taskName: string, items: readonly { readonly status: string }[]): boolean {
		const next = {
			done: items.filter(({ status }) => status === "done").length,
			total: items.length,
		};
		const previous = this.progressByTaskName.get(taskName);
		if (previous?.done === next.done && previous.total === next.total) return false;
		this.progressByTaskName.set(taskName, next);
		return true;
	}

	project(snapshot: SubagentSnapshot): CodingAgentSubagentSnapshot {
		const todoProgress = this.progressByTaskName.get(snapshot.taskName);
		return {
			...snapshot,
			usage: { ...snapshot.usage },
			...(todoProgress ? { todoProgress: { ...todoProgress } } : {}),
		};
	}

	projectAll(snapshots: readonly SubagentSnapshot[]): readonly CodingAgentSubagentSnapshot[] {
		return snapshots.map((snapshot) => this.project(snapshot));
	}

	prune(snapshots: readonly SubagentSnapshot[]): void {
		const retained = new Set(snapshots.map(({ taskName }) => taskName));
		for (const taskName of this.progressByTaskName.keys()) {
			if (!retained.has(taskName)) this.progressByTaskName.delete(taskName);
		}
		for (const taskName of this.initialItemsByTaskName.keys()) {
			if (!retained.has(taskName)) this.initialItemsByTaskName.delete(taskName);
		}
	}
}

export interface CodingAgentSubagentTodoProjectionSeed {
	readonly previous: readonly {
		readonly taskName: string;
		readonly initialItems: readonly string[] | undefined;
		readonly progress: CodingAgentSubagentTodoProgress | undefined;
	}[];
}

function restoreMapEntry<T>(target: Map<string, T>, key: string, value: T | undefined): void {
	if (value === undefined) target.delete(key);
	else target.set(key, value);
}

export function toSubagentSnapshot(snapshot: CodingAgentSubagentSnapshot): SubagentSnapshot {
	const { todoProgress: _todoProgress, ...base } = snapshot;
	return { ...base, usage: { ...base.usage } };
}
