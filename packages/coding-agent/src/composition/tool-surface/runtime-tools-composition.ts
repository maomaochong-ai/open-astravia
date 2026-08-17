import {
	type AgentFeatureDefinition,
	type AgentProfile,
	type CompiledRuntimeSnapshot,
	FeatureCompiler,
	PassthroughContextStrategy,
	RandomIdGenerator,
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
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import type { CodingAgentSpecializedToolRegistrationContext, CodingAgentToolEnvironment } from "../contracts/index.js";

export interface CodingToolsRuntimeCompositionOptions {
	readonly cwd: string;
	readonly environment: CodingAgentToolEnvironment;
	readonly activation?: CodingToolActivation;
	readonly resolveActivation?: CodingToolActivationResolver;
	readonly refreshCatalog?: CodingToolCatalogRefresher;
	readonly filterRegistration?: CodingToolRegistrationFilter;
	readonly additionalRegistrations?: readonly CodingToolRegistration[];
	readonly resultPolicy?: CodingToolResultPolicy;
	readonly tokenBudget?: number;
	readonly reservedOutputTokens?: number;
}

export interface CodingToolsRuntimeComposition {
	readonly cwd: string;
	readonly backgroundService?: BackgroundCommandService;
	readonly createSpecializedToolRegistrations?: (
		context: CodingAgentSpecializedToolRegistrationContext,
	) => readonly CodingToolRegistration[] | Promise<readonly CodingToolRegistration[]>;
	readonly registry: CodingToolRegistry;
	readonly feature: AgentFeatureDefinition;
	readonly profile: AgentProfile;
	readonly compiler: FeatureCompiler;
	readonly compile: (signal?: AbortSignal) => Promise<CompiledRuntimeSnapshot>;
	readonly dispose: () => void;
}

export function createCodingToolsRuntimeComposition(
	options: CodingToolsRuntimeCompositionOptions,
): CodingToolsRuntimeComposition {
	const cwd = options.cwd;
	const backgroundService = options.environment.backgroundService;
	const builtInRegistrations: CodingToolRegistration[] = [
		createCurrentTimeToolRegistration(),
		...(backgroundService
			? [
					createTaskOutputToolRegistration({ backgroundService }),
					createTaskStopToolRegistration({ backgroundService }),
				]
			: []),
	];
	const registry = new InMemoryCodingToolRegistry(
		[
			...options.environment.registrations.filter(({ tool }) => !CODING_AGENT_OWNED_BASE_TOOL_NAMES.has(tool.name)),
			...builtInRegistrations,
			...(options.additionalRegistrations ?? []),
		].map(withCodingAgentModelOrder),
		{ resultPolicy: options.resultPolicy ?? PRESERVE_CODING_TOOL_RESULT_POLICY },
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
	const profile: AgentProfile = {
		id: "coding-tools-runtime",
		instructions: [],
		features: [feature],
		contextStrategy: new PassthroughContextStrategy(),
		toolPolicy: {
			async authorize(_request, signal) {
				signal.throwIfAborted();
				return true;
			},
		},
		tokenBudget: options.tokenBudget ?? 8_000,
		reservedOutputTokens: options.reservedOutputTokens ?? 1_000,
	};
	const compiler = new FeatureCompiler({ idGenerator: new RandomIdGenerator() });

	return {
		cwd,
		backgroundService,
		createSpecializedToolRegistrations: options.environment.createSpecializedToolRegistrations,
		registry,
		feature,
		profile,
		compiler,
		compile: (signal = new AbortController().signal) => compiler.compile(profile, signal),
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

function withCodingAgentModelOrder(registration: CodingToolRegistration): CodingToolRegistration {
	const modelOrder = CODING_AGENT_BASE_TOOL_ORDER[registration.tool.name];
	return modelOrder === undefined ? registration : withModelOrder(registration, modelOrder);
}

function withModelOrder(registration: CodingToolRegistration, modelOrder: number): CodingToolRegistration {
	return {
		...registration,
		modelOrder,
		tool: { ...registration.tool, modelOrder },
	};
}
