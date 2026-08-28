import type { RuntimeObservationPublisher } from "@vetta/runtime-core";
import {
	type AgentFeatureDefinition,
	type CompiledRuntimeSnapshot,
	createDefaultRuntimeCapabilityDefinition,
	FeatureCompiler,
	RandomIdGenerator,
	type RuntimeCapabilityDefinition,
} from "@vetta/runtime-core/kernel";
import {
	type BackgroundCommandService,
	type CodingToolActivation,
	type CodingToolActivationResolver,
	type CodingToolCatalogRefresher,
	type CodingToolRegistration,
	type CodingToolRegistrationFilter,
	type CodingToolRegistry,
	type CodingToolResultPolicy,
	createCodingToolsFeature,
	InMemoryCodingToolRegistry,
	PRESERVE_CODING_TOOL_RESULT_POLICY,
} from "@vetta/runtime-tools";
import {
	createTaskOutputToolRegistration,
	createTaskStopToolRegistration,
} from "../../features/background-tasks/index.js";
import { createCurrentTimeToolRegistration } from "../../features/current-time/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../runtime-contracts/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import type { ToolSideEffectDeclaration } from "../../tool-policy/tool-side-effect.js";
import type { CodingAgentSpecializedToolRegistrationContext, CodingAgentToolEnvironment } from "../contracts/index.js";

export interface CodingToolsRuntimeCompositionOptions {
	readonly cwd: string;
	readonly environment: CodingAgentToolEnvironment;
	readonly activation?: CodingToolActivation;
	readonly resolveActivation?: CodingToolActivationResolver;
	readonly refreshCatalog?: CodingToolCatalogRefresher;
	readonly filterRegistration?: CodingToolRegistrationFilter;
	readonly additionalRegistrations?: readonly CodingAgentRuntimeToolRegistration[];
	readonly resultPolicy?: CodingToolResultPolicy;
	readonly tokenBudget?: number;
	readonly reservedOutputTokens?: number;
	readonly observationPublisher?: RuntimeObservationPublisher;
}

export interface CodingToolsRuntimeComposition {
	readonly cwd: string;
	readonly backgroundService?: BackgroundCommandService;
	readonly createSpecializedToolRegistrations?: (
		context: CodingAgentSpecializedToolRegistrationContext,
	) => readonly CodingToolRegistration[] | Promise<readonly CodingToolRegistration[]>;
	readonly registry: CodingToolRegistry;
	/** Coding Agent 自有工具的产品策略声明；通用 Runtime Tool Catalog 不承载这些元数据。 */
	readonly readToolPolicyDeclarations: () => readonly ToolSideEffectDeclaration[];
	readonly feature: AgentFeatureDefinition;
	readonly capabilities: RuntimeCapabilityDefinition;
	readonly compiler: FeatureCompiler;
	readonly compile: (signal?: AbortSignal) => Promise<CompiledRuntimeSnapshot>;
	readonly dispose: () => void;
}

export function createCodingToolsRuntimeComposition(
	options: CodingToolsRuntimeCompositionOptions,
): CodingToolsRuntimeComposition {
	const cwd = options.cwd;
	const backgroundService = options.environment.backgroundService;
	const builtInRegistrations: CodingAgentRuntimeToolRegistration[] = [
		createCurrentTimeToolRegistration(),
		...(backgroundService
			? [
					createTaskOutputToolRegistration({ backgroundService }),
					createTaskStopToolRegistration({ backgroundService }),
				]
			: []),
	];
	const codingAgentRegistrations = [...builtInRegistrations, ...(options.additionalRegistrations ?? [])].map(
		withCodingAgentModelOrder,
	);
	const registry = new InMemoryCodingToolRegistry(
		[
			...options.environment.registrations
				.filter(({ tool }) => !CODING_AGENT_OWNED_BASE_TOOL_NAMES.has(tool.name))
				.map(withCodingAgentModelOrder)
				.map(toRuntimeToolRegistration),
			...codingAgentRegistrations.map(toRuntimeToolRegistration),
		],
		{
			resultPolicy: options.resultPolicy ?? PRESERVE_CODING_TOOL_RESULT_POLICY,
			observationPublisher: options.observationPublisher,
		},
	);
	const feature = createCodingToolsFeature({
		catalog: registry,
		resolveActivation: options.resolveActivation,
		refreshCatalog: options.refreshCatalog,
		filterRegistration: options.filterRegistration,
		activation:
			options.activation ??
			(backgroundService
				? { mode: "scope", scope: "cli", capabilities: new Set(["bg-tasks"]) }
				: { mode: "scope", scope: "cli" }),
	});
	const capabilities: RuntimeCapabilityDefinition = createDefaultRuntimeCapabilityDefinition({
		features: [feature],
		toolPolicy: {
			async authorize(_request, signal) {
				signal.throwIfAborted();
				return true;
			},
		},
		tokenBudget: options.tokenBudget ?? 8_000,
		reservedOutputTokens: options.reservedOutputTokens ?? 1_000,
		observationPublisher: options.observationPublisher,
	});
	const compiler = new FeatureCompiler({ idGenerator: new RandomIdGenerator() });

	return {
		cwd,
		backgroundService,
		createSpecializedToolRegistrations: options.environment.createSpecializedToolRegistrations,
		registry,
		readToolPolicyDeclarations: () =>
			codingAgentRegistrations.map((registration) => ({
				name: registration.tool.name,
				sideEffect: registration.sideEffect,
			})),
		feature,
		capabilities,
		compiler,
		compile: (signal = new AbortController().signal) => compiler.compile(capabilities, signal),
		dispose: () => options.environment.dispose(),
	};
}

const CODING_AGENT_BASE_TOOL_ORDER: Readonly<Record<string, number>> = {
	current_time: CODING_AGENT_MODEL_TOOL_ORDER.currentTime,
	read: CODING_AGENT_MODEL_TOOL_ORDER.read,
	edit: CODING_AGENT_MODEL_TOOL_ORDER.edit,
	bash: CODING_AGENT_MODEL_TOOL_ORDER.command,
	shell: CODING_AGENT_MODEL_TOOL_ORDER.command,
	task_output: CODING_AGENT_MODEL_TOOL_ORDER.taskOutput,
	task_stop: CODING_AGENT_MODEL_TOOL_ORDER.taskStop,
	ls: CODING_AGENT_MODEL_TOOL_ORDER.ls,
	glob: CODING_AGENT_MODEL_TOOL_ORDER.glob,
	grep: CODING_AGENT_MODEL_TOOL_ORDER.grep,
	find: CODING_AGENT_MODEL_TOOL_ORDER.find,
	tree: CODING_AGENT_MODEL_TOOL_ORDER.directoryTree,
	write: CODING_AGENT_MODEL_TOOL_ORDER.write,
};

const CODING_AGENT_OWNED_BASE_TOOL_NAMES = new Set<string>(["current_time", "task_output", "task_stop"]);

function withCodingAgentModelOrder<T extends CodingToolRegistration>(registration: T): T {
	const modelOrder = CODING_AGENT_BASE_TOOL_ORDER[registration.tool.name];
	return modelOrder === undefined ? registration : withModelOrder(registration, modelOrder);
}

function withModelOrder<T extends CodingToolRegistration>(registration: T, modelOrder: number): T {
	return {
		...registration,
		modelOrder,
		tool: { ...registration.tool, modelOrder },
	} as T;
}

/** 产品策略字段在进入通用 Runtime Tool Catalog 前必须被剥离。 */
function toRuntimeToolRegistration(registration: CodingAgentRuntimeToolRegistration): CodingToolRegistration {
	const { sideEffect: _sideEffect, ...runtimeRegistration } = registration;
	return runtimeRegistration;
}
