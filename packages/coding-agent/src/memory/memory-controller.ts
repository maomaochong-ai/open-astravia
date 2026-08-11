import type { AgentMessage } from "@vetta/agent-core";
import type { Api, Model } from "@vetta/ai";
import type { CodingAgentMemoryRolloverRuntime } from "./memory-runtime-contract.js";

export interface CodingAgentMemoryController {
	flushMemory(signal?: AbortSignal): Promise<number>;
}

export interface CodingAgentSessionMemoryControllerOptions {
	readonly runtime: CodingAgentMemoryRolloverRuntime;
	readonly readMessages: () => Promise<readonly AgentMessage[]> | readonly AgentMessage[];
	readonly readModel: () => Model<Api> | undefined;
	readonly resolveApiKey: (model: Model<Api>) => Promise<string | undefined> | string | undefined;
}

/**
 * Session 宿主的按需 MEMORY flush 边界。
 *
 * 当前上下文、模型和凭据由 Composition Root 提供；Memory 文件与写入策略继续由
 * CodingAgentMemoryRolloverRuntime 持有。
 */
export class CodingAgentSessionMemoryController implements CodingAgentMemoryController {
	private readonly options: CodingAgentSessionMemoryControllerOptions;

	constructor(options: CodingAgentSessionMemoryControllerOptions) {
		this.options = options;
	}

	async flushMemory(signal: AbortSignal = new AbortController().signal): Promise<number> {
		const model = this.options.readModel();
		if (!model) return 0;
		const apiKey = await this.options.resolveApiKey(model);
		if (!apiKey) return 0;
		const messages = await this.options.readMessages();
		if (messages.length === 0) return 0;
		return this.options.runtime.flushMessages({ messages, model, apiKey, signal });
	}
}
