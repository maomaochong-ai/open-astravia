import type { BackgroundCommandService, BackgroundCommandSnapshot } from "@vetta/runtime-tools";
import type { CodingAgentSubagentSnapshot } from "../../runtime-contracts/index.js";

export interface CodingAgentSubagentWorkRuntime {
	clearFinished(): number;
	list(): readonly CodingAgentSubagentSnapshot[];
	interrupt(target: string): CodingAgentSubagentSnapshot | undefined;
}

export interface CodingAgentBackgroundWorkRuntime {
	clearFinished(): number;
	clearFinishedTasks(): number;
	clearFinishedSubagents(): number;
	killTask(taskId: string): boolean;
	readTasks(): readonly BackgroundCommandSnapshot[];
	readSubagents(): readonly CodingAgentSubagentSnapshot[];
	interruptSubagent(target: string): CodingAgentSubagentSnapshot | undefined;
}

/** Runtime BackgroundCommandService 到宿主工作面板合同的无状态投影。 */
export class CodingAgentBackgroundWorkController implements CodingAgentBackgroundWorkRuntime {
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
		return this.backgroundService.stop(taskId, "caller");
	}

	readTasks(): readonly BackgroundCommandSnapshot[] {
		return this.backgroundService.list().map((task) => ({ ...task }));
	}

	readSubagents(): readonly CodingAgentSubagentSnapshot[] {
		return this.subagents?.list().map((subagent) => ({ ...subagent, usage: { ...subagent.usage } })) ?? [];
	}

	interruptSubagent(target: string): CodingAgentSubagentSnapshot | undefined {
		return this.subagents?.interrupt(target);
	}
}
