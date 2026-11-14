import {
	CODING_AGENT_BACKGROUND_TASKS_CLEAR_FINISHED,
	CODING_AGENT_SUBAGENTS_CLEAR_FINISHED,
} from "@astravia/coding-agent/function-extensions";
import type { RuntimeHost } from "@astravia/runtime-core";

export interface ClearFinishedWorkResult {
	readonly tasks: number;
	readonly subagents: number;
}

/**
 * 「清除已结束」要清的到底是哪几类。
 *
 * 后台任务面板同时列着后台命令、子代理与 MCP 任务三类，按钮上的数字也是三者之和。
 * 但清除原先只调了「后台命令」那一个扩展：bash 行清掉了、子代理行还在，
 * 用户看到的就是「点了没反应」。子代理的清除能力早就存在
 * （`SUBAGENTS_CLEAR_FINISHED`），只是这条路径没接上。
 *
 * 两类分别 try/catch：某一类扩展没注册（旧会话、只读宿主）不该让另一类也清不掉。
 */
export async function clearFinishedWork(
	runtime: Pick<RuntimeHost, "invokeSessionExtension">,
	sessionId: string,
): Promise<ClearFinishedWorkResult> {
	const invoke = async (token: typeof CODING_AGENT_BACKGROUND_TASKS_CLEAR_FINISHED): Promise<number> => {
		try {
			const cleared = await runtime.invokeSessionExtension(sessionId, token, undefined);
			return typeof cleared === "number" ? cleared : 0;
		} catch {
			return 0;
		}
	};
	const tasks = await invoke(CODING_AGENT_BACKGROUND_TASKS_CLEAR_FINISHED);
	const subagents = await invoke(CODING_AGENT_SUBAGENTS_CLEAR_FINISHED);
	return { tasks, subagents };
}
