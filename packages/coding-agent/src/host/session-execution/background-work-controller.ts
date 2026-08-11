import type { RuntimeSessionBackgroundWorkController, RuntimeSubagentSnapshot } from "@vetta/runtime-core";
import type { BackgroundCommandService } from "@vetta/runtime-tools/coding";

export interface CodingAgentSubagentWorkRuntime {
	clearFinished(): number;
	list(): readonly RuntimeSubagentSnapshot[];
	interrupt(target: string): RuntimeSubagentSnapshot | undefined;
}

/** Runtime BackgroundCommandService 到宿主工作面板合同的无状态投影。 */
export class CodingAgentBackgroundWorkController implements RuntimeSessionBackgroundWorkController {
	constructor(
		private readonly backgroundService: BackgroundCommandService,
		private readonly subagents?: CodingAgentSubagentWorkRuntime,
	) {}

	clearFinished(): number {
		return this.backgroundService.clearFinished() + (this.subagents?.clearFinished() ?? 0);
	}

	clearFinishedTasks(): number {
		return this.backgroundService.clearFinished();
	}

	clearFinishedSubagents(): number {
		return this.subagents?.clearFinished() ?? 0;
	}

	killTask(taskId: string): boolean {
		return this.backgroundService.stop(taskId, "user");
	}

	readTasks(): ReturnType<RuntimeSessionBackgroundWorkController["readTasks"]> {
		return this.backgroundService.list().map((task) => ({ ...task }));
	}

	readSubagents(): readonly RuntimeSubagentSnapshot[] {
		return this.subagents?.list().map((subagent) => ({ ...subagent, usage: { ...subagent.usage } })) ?? [];
	}

	interruptSubagent(target: string): RuntimeSubagentSnapshot | undefined {
		return this.subagents?.interrupt(target);
	}
}
