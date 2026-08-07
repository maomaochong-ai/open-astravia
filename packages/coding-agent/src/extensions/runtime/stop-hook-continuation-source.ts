import type { UserMessage } from "@vetta/ai";
import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter/hooks";
import type { ContinuationPolicyContext } from "@vetta/runtime-core/kernel";
import type { CodingAgentContinuationSource } from "../../composition/turn/continuation-orchestrator.js";
import { getLastAssistantText } from "../../sessions/index.js";

export interface CodingAgentStopHookContinuationSourceOptions {
	readonly hookRuntime: Pick<EcosystemHookRuntime, "runStop">;
	readonly now?: () => number;
}

/** 把既有 Ecosystem Stop Hook 的文本片段适配为普通 continuation UserMessage。 */
export class CodingAgentStopHookContinuationSource implements CodingAgentContinuationSource {
	private readonly now: () => number;

	constructor(private readonly options: CodingAgentStopHookContinuationSourceOptions) {
		this.now = options.now ?? Date.now;
	}

	async collect(context: ContinuationPolicyContext): Promise<readonly UserMessage[]> {
		if (context.signal.aborted) return [];
		const fragments = await this.options.hookRuntime.runStop(
			getLastAssistantText([...context.messages]) ?? null,
			context.signal,
		);
		return fragments.map((text) => ({
			role: "user",
			content: [{ type: "text", text }],
			timestamp: this.now(),
		}));
	}
}
