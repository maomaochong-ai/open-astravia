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
	type CodingToolExecutableResolver,
	type CodingToolRegistration,
	type CodingToolRegistrationFilter,
	type CodingToolRegistry,
	type CommandToolExecutor,
	createBackgroundCommandService,
	createBackgroundCommandToolExecutor,
	createBashToolRegistration,
	createCodingToolsFeature,
	createCurrentTimeToolRegistration,
	createEditToolRegistration,
	createFindToolRegistration,
	createForegroundCommandToolExecutor,
	createGlobToolRegistration,
	createGrepToolRegistration,
	createLsToolRegistration,
	createReadToolRegistration,
	createShellToolRegistration,
	createTaskOutputToolRegistration,
	createTaskStopToolRegistration,
	createTreeToolRegistration,
	createWriteToolRegistration,
	InMemoryCodingToolRegistry,
} from "@vetta/runtime-tools/coding";
import {
	createCodingAgentBackgroundCommandHost,
	createCodingAgentEditPathPolicy,
	createCodingAgentForegroundCommandHost,
	createCodingAgentWritePathPolicy,
	createManagedCodingToolExecutableResolver,
	type ResolveCodingToolExecutable,
} from "../../adapters/runtime-tools/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";

export interface CodingToolsRuntimeCompositionOptions {
	readonly cwd?: string;
	readonly activation?: CodingToolActivation;
	readonly resolveActivation?: CodingToolActivationResolver;
	readonly refreshCatalog?: CodingToolCatalogRefresher;
	readonly filterRegistration?: CodingToolRegistrationFilter;
	readonly backgroundService?: BackgroundCommandService;
	readonly commandExecutor?: CommandToolExecutor;
	readonly ensureTool?: ResolveCodingToolExecutable;
	readonly additionalRegistrations?: readonly CodingToolRegistration[];
	readonly tokenBudget?: number;
	readonly reservedOutputTokens?: number;
}

export interface CodingToolsRuntimeComposition {
	readonly cwd: string;
	readonly backgroundService?: BackgroundCommandService;
	readonly commandExecutor: CommandToolExecutor;
	readonly executableResolver: CodingToolExecutableResolver;
	readonly registry: CodingToolRegistry;
	readonly feature: AgentFeatureDefinition;
	readonly profile: AgentProfile;
	readonly compiler: FeatureCompiler;
	readonly compile: (signal?: AbortSignal) => Promise<CompiledRuntimeSnapshot>;
	readonly dispose: () => void;
}

export function createCodingToolsRuntimeComposition(
	options: CodingToolsRuntimeCompositionOptions = {},
): CodingToolsRuntimeComposition {
	const cwd = options.cwd ?? process.cwd();
	const commandHost = createCodingAgentForegroundCommandHost(cwd);
	const backgroundService =
		options.backgroundService ??
		(options.commandExecutor ? undefined : createBackgroundCommandService(createCodingAgentBackgroundCommandHost()));
	const foregroundExecutor = createForegroundCommandToolExecutor(commandHost);
	const commandExecutor =
		options.commandExecutor ??
		(backgroundService
			? createBackgroundCommandToolExecutor({
					...commandHost,
					foregroundExecutor,
					backgroundService,
				})
			: foregroundExecutor);
	const executableResolver = createManagedCodingToolExecutableResolver(options.ensureTool);
	const registry = new InMemoryCodingToolRegistry([
		withModelOrder(createCurrentTimeToolRegistration(), CODING_AGENT_MODEL_TOOL_ORDER.currentTime),
		withModelOrder(createReadToolRegistration(cwd), CODING_AGENT_MODEL_TOOL_ORDER.read),
		withModelOrder(
			createEditToolRegistration(cwd, { pathPolicy: createCodingAgentEditPathPolicy(cwd) }),
			CODING_AGENT_MODEL_TOOL_ORDER.edit,
		),
		withModelOrder(
			createBashToolRegistration(cwd, { executor: commandExecutor }),
			CODING_AGENT_MODEL_TOOL_ORDER.command,
		),
		withModelOrder(
			createShellToolRegistration(cwd, { executor: commandExecutor }),
			CODING_AGENT_MODEL_TOOL_ORDER.command,
		),
		...(backgroundService
			? [
					withModelOrder(
						createTaskOutputToolRegistration({ backgroundService }),
						CODING_AGENT_MODEL_TOOL_ORDER.taskOutput,
					),
					withModelOrder(
						createTaskStopToolRegistration({ backgroundService }),
						CODING_AGENT_MODEL_TOOL_ORDER.taskStop,
					),
				]
			: []),
		withModelOrder(createLsToolRegistration(cwd), CODING_AGENT_MODEL_TOOL_ORDER.ls),
		withModelOrder(createGlobToolRegistration(cwd), CODING_AGENT_MODEL_TOOL_ORDER.glob),
		withModelOrder(createGrepToolRegistration(cwd, { executableResolver }), CODING_AGENT_MODEL_TOOL_ORDER.grep),
		withModelOrder(createFindToolRegistration(cwd, { executableResolver }), CODING_AGENT_MODEL_TOOL_ORDER.find),
		withModelOrder(
			createTreeToolRegistration(cwd, { executableResolver }),
			CODING_AGENT_MODEL_TOOL_ORDER.directoryTree,
		),
		withModelOrder(
			createWriteToolRegistration(cwd, { pathPolicy: createCodingAgentWritePathPolicy(cwd) }),
			CODING_AGENT_MODEL_TOOL_ORDER.write,
		),
		...(options.additionalRegistrations ?? []),
	]);
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
		commandExecutor,
		executableResolver,
		registry,
		feature,
		profile,
		compiler,
		compile: (signal = new AbortController().signal) => compiler.compile(profile, signal),
		dispose: () => backgroundService?.dispose(),
	};
}

function withModelOrder(registration: CodingToolRegistration, modelOrder: number): CodingToolRegistration {
	return {
		...registration,
		modelOrder,
		tool: { ...registration.tool, modelOrder },
	};
}
