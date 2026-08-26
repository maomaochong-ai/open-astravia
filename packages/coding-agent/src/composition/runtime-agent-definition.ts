import type {
	RuntimeAgentDefinition,
	RuntimeAgentInstancePreparationContext,
	RuntimeAgentSessionDefinition,
	RuntimeAgentSessionPreparationContext,
} from "@vetta/runtime-core";
import type { InstructionBlock } from "@vetta/runtime-core/kernel";

export const DEFAULT_CODING_AGENT_RUNTIME_ID = "coding-agent";

/** Coding Agent 产品层的 Prompt 预设；该类型不会进入 runtime-core。 */
export interface CodingAgentPromptProfile {
	readonly instructions: readonly InstructionBlock[];
}

export type CodingAgentRuntimeInstanceContext<TConfiguration> = Omit<
	RuntimeAgentInstancePreparationContext,
	"configuration"
> & {
	readonly configuration: TConfiguration;
};

export type CodingAgentRuntimeSessionContext<TConfiguration> = Omit<
	RuntimeAgentSessionPreparationContext,
	"configuration"
> & {
	readonly configuration: TConfiguration;
};

export interface CodingAgentRuntimeInstanceAssembly<TSessionConfiguration> {
	/**
	 * 只解析产品 Prompt 预设。Tool、MCP、模型和 Extension 必须由 prepareSession() 的能力装配显式提供。
	 */
	resolvePromptProfile?(
		context: CodingAgentRuntimeSessionContext<TSessionConfiguration>,
	): Promise<CodingAgentPromptProfile | undefined> | CodingAgentPromptProfile | undefined;
	prepareSession(
		context: CodingAgentRuntimeSessionContext<TSessionConfiguration>,
	): Promise<RuntimeAgentSessionDefinition> | RuntimeAgentSessionDefinition;
	dispose?(): Promise<void> | void;
}

export interface CodingAgentRuntimeDefinitionOptions<TInstanceConfiguration, TSessionConfiguration> {
	readonly id?: string;
	/** 不可信宿主配置首次进入 Coding Agent 产品边界时的解析器。 */
	readonly parseInstanceConfiguration: (configuration: unknown) => TInstanceConfiguration;
	/** 不可信 Session 配置首次进入 Coding Agent 产品边界时的解析器。 */
	readonly parseSessionConfiguration: (configuration: unknown) => TSessionConfiguration;
	createInstance(
		context: CodingAgentRuntimeInstanceContext<TInstanceConfiguration>,
	):
		| Promise<CodingAgentRuntimeInstanceAssembly<TSessionConfiguration>>
		| CodingAgentRuntimeInstanceAssembly<TSessionConfiguration>;
	dispose?(): Promise<void> | void;
}

/**
 * 将完整 Coding Agent 产品装配适配为通用多主 Agent Definition。
 *
 * Profile 在这里被消解为普通 Instruction；Runtime 只接收能力、模型、Extension 和资源释放合同。
 */
export function createCodingAgentRuntimeDefinition<TInstanceConfiguration, TSessionConfiguration>(
	options: CodingAgentRuntimeDefinitionOptions<TInstanceConfiguration, TSessionConfiguration>,
): RuntimeAgentDefinition {
	return {
		id: requireAgentId(options.id ?? DEFAULT_CODING_AGENT_RUNTIME_ID),
		async createInstance(context) {
			const assembly = await options.createInstance({
				...context,
				configuration: options.parseInstanceConfiguration(context.configuration),
			});
			return {
				async prepareSession(sessionContext) {
					const codingContext: CodingAgentRuntimeSessionContext<TSessionConfiguration> = {
						...sessionContext,
						configuration: options.parseSessionConfiguration(sessionContext.configuration),
					};
					const profile = await assembly.resolvePromptProfile?.(codingContext);
					const definition = await assembly.prepareSession(codingContext);
					const dispose = definition.dispose?.bind(definition);
					return {
						...definition,
						capabilities: {
							...definition.capabilities,
							instructions: Object.freeze([
								...(profile?.instructions ?? []),
								...definition.capabilities.instructions,
							]),
							observationPublisher: sessionContext.observationPublisher,
						},
						...(dispose ? { dispose } : {}),
					};
				},
				...(assembly.dispose ? { dispose: () => assembly.dispose?.() } : {}),
			};
		},
		...(options.dispose ? { dispose: () => options.dispose?.() } : {}),
	};
}

function requireAgentId(value: string): string {
	if (!value || value.trim() !== value) {
		throw new Error("Coding Agent runtime id must be a non-empty trimmed string");
	}
	return value;
}
