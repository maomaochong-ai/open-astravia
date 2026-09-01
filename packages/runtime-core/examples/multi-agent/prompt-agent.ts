import { defineRuntimeAgent, type RuntimeAgentDefinition } from "@vetta/runtime-core";
import { createDefaultRuntimeCapabilityDefinition } from "@vetta/runtime-core/kernel";

export interface PromptAgentOptions {
	readonly id: string;
	readonly instruction: string;
}

/**
 * 最小的 Agent Definition 工厂。
 *
 * 真实产品可以在同一边界加入 Tool、MCP、模型绑定和 Session Extension；
 * Runtime Core 仍只负责 Definition/Instance/Session/Snapshot 生命周期。
 */
export function createPromptAgent(options: PromptAgentOptions): RuntimeAgentDefinition {
	return defineRuntimeAgent({
		id: options.id,
		createInstance: () => ({
			prepareSession: () => ({
				capabilities: createDefaultRuntimeCapabilityDefinition({
					instructions: [
						{
							id: `${options.id}.base`,
							content: options.instruction,
							priority: 0,
						},
					],
				}),
			}),
		}),
	});
}
