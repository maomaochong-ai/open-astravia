import { join } from "node:path";
import {
	CODING_AGENT_COMPACTION_PREFIRE_OBSERVATION,
	CODING_AGENT_LIFECYCLE_ISSUE_OBSERVATION,
	CODING_AGENT_PLUGIN_CONFIGURATION_OBSERVATION,
	CODING_AGENT_SESSION_ASSISTANCE_OBSERVATION,
	CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION,
	CODING_AGENT_SUBAGENT_ISSUE_OBSERVATION,
	createCodingAgentMemoryRolloverRuntime,
	publishCodingAgentExecutionRuntimeDefinition,
} from "@vetta/coding-agent/composition";
import { getAgentDir } from "@vetta/coding-agent/config";
import {
	createCodingAgentMcpRuntimeToolSource,
	createCodingAgentPluginMcpRuntime,
	createCodingAgentSharedModelController,
} from "@vetta/coding-agent/host-services";
import { AGENT_CONFIGURATION_OBSERVATION } from "@vetta/coding-agent/session-extensions";
import {
	CatalogRoutedRuntimeHostSessionBackend,
	CatalogRoutedRuntimeSessionAccessResolver,
	CompositeRuntimeSessionCatalog,
	CompositeRuntimeSessionFileHistoryReader,
	RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
	RUNTIME_HOST_LIFECYCLE_OBSERVATION,
	RUNTIME_TURN_RETRY_LIFECYCLE_OBSERVATION,
	type RuntimeAgentRuntime,
	RuntimeHost,
	type RuntimeHostSessionBackendRouteDecision,
	RuntimeObservationHub,
	type RuntimeObservationPublisher,
} from "@vetta/runtime-core";
import {
	createDesktopHistoricalSessionFormat,
	createDesktopResultArtifactRuntime,
	createDesktopRuntimeHostPlatformServices,
	createRuntimeSessionCompactionLogger,
	DesktopHistoricalSessionImportBackend,
	DesktopRuntimeBackendPool,
	type DesktopRuntimeComposition,
	DesktopRuntimeSessionCatalog,
	isSessionPathInDirectory,
	logRuntimeSessionError,
	PathFilteredRuntimeSessionCatalog,
} from "@vetta/runtime-desktop";
import { FileConversationRuntimeSessionFileHistoryReader } from "@vetta/runtime-node/conversation";
import { createNodeKnowledgeRuntime, NodeTextFileStorage } from "@vetta/runtime-node/host";
import { getModePrompt } from "../agent-modes/index.js";
import { createDesktopAgentTraceRecorder } from "../agent-observability/composition.js";
import {
	DEFAULT_CONVERSATION_CWD,
	DEFAULT_IM_CONVERSATION_SESSION_DIR,
	readDesktopConfig,
} from "../config/desktop-config-store.js";
import { DEFAULT_SERVER_URL } from "../constants.js";
import { resolveDesktopRuntimeSessionRoots } from "../conversations/session-catalog-roots.js";
import { resolveSessionListCwd } from "../conversations/session-paths.js";
import { getKnowledgeRoot } from "../knowledge/knowledge-layout.js";
import { getAppLogger } from "../logger.js";
import { getDesktopMcpAppRegistry } from "../mcp/mcp-app-runtime.js";
import { getDesktopMcpTaskCoordinator } from "../mcp/mcp-task-runtime.js";
import { createDesktopPluginHookAdapterFactory } from "../plugins/coding-agent-hook-adapter.js";
import { pluginAgentContributionService } from "../plugins/plugin-catalog.js";
import { getDesktopCodingAgentPluginRuntimeSource } from "../plugins/plugin-runtime-service.js";
import { getAvailableLinuxBubblewrapPath, getAvailableMacosSandboxExecPath } from "../sandbox/capability.js";
import { resolveWindowsSandboxHostBinary } from "../sandbox/windows-binary-resolver.js";
import { createCodingAgentObservationLogPort } from "./coding-agent-observation-log-port.js";
import { createDesktopCodingAgentFunctionSource } from "./function-extension-source.js";
import { getOrCreateSharedModelRuntime, readDesktopMcpDebug } from "./host-services.js";
import { createDesktopMcpSupervisor } from "./mcp-supervisor.js";
import { getDesktopProviderObservationRuntime } from "./provider-observation.js";
import { createDesktopPromptRuntimeSources } from "./resource-runtime.js";
import { createRuntimeLifecycleLogPort } from "./runtime-lifecycle-log-port.js";
import { createRuntimeRetryLogPort } from "./runtime-retry-log-port.js";
import { createSessionInitializationLogPort } from "./session-initialization-log-port.js";

const log = getAppLogger("runtime");

export function createDesktopRuntimeComposition(): DesktopRuntimeComposition {
	const traceRecorder = createDesktopAgentTraceRecorder();
	const observationHub = new RuntimeObservationHub({
		onIssue: (issue) => log.warn("[runtime-observation] application hub issue", issue),
	});
	observationHub.attach(traceRecorder, { id: "desktop.agent-traces" });
	observationHub.attach(createSessionInitializationLogPort(log), {
		id: "desktop.session-initialization-log",
		domains: [CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION.domain],
	});
	observationHub.attach(createRuntimeLifecycleLogPort(log), {
		id: "desktop.runtime-lifecycle-log",
		domains: [
			RUNTIME_AGENT_LIFECYCLE_OBSERVATION.domain,
			RUNTIME_HOST_LIFECYCLE_OBSERVATION.domain,
			AGENT_CONFIGURATION_OBSERVATION.domain,
		],
	});
	observationHub.attach(createRuntimeRetryLogPort(log), {
		id: "desktop.runtime-retry-log",
		domains: [RUNTIME_TURN_RETRY_LIFECYCLE_OBSERVATION.domain],
	});
	observationHub.attach(createCodingAgentObservationLogPort(log), {
		id: "desktop.coding-agent-observation-log",
		domains: [
			CODING_AGENT_COMPACTION_PREFIRE_OBSERVATION.domain,
			CODING_AGENT_LIFECYCLE_ISSUE_OBSERVATION.domain,
			CODING_AGENT_PLUGIN_CONFIGURATION_OBSERVATION.domain,
			CODING_AGENT_SESSION_ASSISTANCE_OBSERVATION.domain,
			CODING_AGENT_SUBAGENT_ISSUE_OBSERVATION.domain,
		],
	});
	const platformServices = createDesktopRuntimeHostPlatformServices();
	const modelRuntime = getOrCreateSharedModelRuntime();
	const mcpTaskCoordinator = getDesktopMcpTaskCoordinator();
	const mcpAppHost = getDesktopMcpAppRegistry();
	const providerObservationRuntime = getDesktopProviderObservationRuntime();
	const getDefaultExecutionMode = async () => (await readDesktopConfig()).defaultExecutionMode;
	const sandboxHostPath = resolveWindowsSandboxHostBinary()?.path;
	const linuxBubblewrapPath = getAvailableLinuxBubblewrapPath();
	const macosSandboxExecPath = getAvailableMacosSandboxExecPath();
	const sessionExtensionFunctions = createDesktopCodingAgentFunctionSource();
	const historicalFormat = createDesktopHistoricalSessionFormat();
	const defaultResultArtifacts = createDesktopResultArtifactRuntime(getAgentDir());
	const conversationCatalog = new DesktopRuntimeSessionCatalog({
		resolveRoots: resolveDesktopRuntimeSessionRoots,
		artifactCleaner: defaultResultArtifacts.sessionArtifactCleaner,
	});
	const imConversationCatalog = new PathFilteredRuntimeSessionCatalog(conversationCatalog, (sessionPath) =>
		isSessionPathInDirectory(sessionPath, DEFAULT_IM_CONVERSATION_SESSION_DIR),
	);
	const desktopRuntimeCatalog = new PathFilteredRuntimeSessionCatalog(
		conversationCatalog,
		(sessionPath) => !isSessionPathInDirectory(sessionPath, DEFAULT_IM_CONVERSATION_SESSION_DIR),
	);
	const createRuntimeBackendPool = (
		agentRuntime: RuntimeAgentRuntime,
		observationPublisher: RuntimeObservationPublisher,
	) =>
		new DesktopRuntimeBackendPool({
			observationPublisher,
			compositionDefaults: {
				tracer: traceRecorder,
				tracing: { captureContent: false, detail: "standard" },
				agentRuntime: { runtime: agentRuntime },
				modelRegistry: modelRuntime,
				createPromptRuntimeSources: createDesktopPromptRuntimeSources,
				createPluginRuntime: () => getDesktopCodingAgentPluginRuntimeSource(),
				// 工作模式注册表归 desktop 所有（ADR-0071 修订）：coding-agent 只保留 core.mode
				// 槽位，正文由这里按会话固化的 agentMode 解析注入。
				resolveModePrompt: getModePrompt,
				sessionExtensionFunctions,
				knowledgeRuntime:
					process.env.VETTA_KNOWLEDGE_DISABLED === "1"
						? undefined
						: createNodeKnowledgeRuntime(getKnowledgeRoot()),
				createMemoryRolloverRuntime: (options) => {
					const memoryFile = options.memoryFile ?? join(options.cwd, "MEMORY.md");
					return createCodingAgentMemoryRolloverRuntime({
						cwd: options.cwd,
						memoryFile,
						memoryCharLimit: options.memoryCharLimit,
						memoryStorage: new NodeTextFileStorage(memoryFile),
						journalStorage: new NodeTextFileStorage(join(options.cwd, "JOURNAL.md")),
					});
				},
				observationHub: {
					onIssue: (issue) => log.warn("[runtime-observation] coding agent hub issue", issue),
				},
				...(providerObservationRuntime ? { streamFn: providerObservationRuntime.streamFn } : {}),
				createPluginMcpRuntime: ({ cwd, agentDir }) => {
					const resolvedAgentDir = agentDir ?? getAgentDir();
					const resultArtifacts = createDesktopResultArtifactRuntime(resolvedAgentDir);
					return createCodingAgentPluginMcpRuntime({
						supervisor: createDesktopMcpSupervisor({
							projectRoot: cwd,
							agentDir: resolvedAgentDir,
							debug: readDesktopMcpDebug(cwd, resolvedAgentDir),
							dynamicOnly: true,
						}),
						debug: readDesktopMcpDebug(cwd, resolvedAgentDir),
						resultPolicy: resultArtifacts.mcpToolResultPolicy,
						taskCoordinator: mcpTaskCoordinator,
						appHost: mcpAppHost,
					});
				},
			},
			createSessionHookAdapterFactories: ({ scenario }, { isPluginEnabled }) => [
				createDesktopPluginHookAdapterFactory({
					scenario,
					canInvoke: (pluginId) =>
						isPluginEnabled(pluginId) && pluginAgentContributionService.canInvokeHook(pluginId),
				}),
			],
			createCodingToolResultPolicy: ({ agentDir }) =>
				createDesktopResultArtifactRuntime(agentDir ?? getAgentDir()).codingToolResultPolicy,
			createMcpRuntimeSource: async ({ cwd, agentDir }) => {
				const resolvedAgentDir = agentDir ?? getAgentDir();
				const resultArtifacts = createDesktopResultArtifactRuntime(resolvedAgentDir);
				return await createCodingAgentMcpRuntimeToolSource({
					supervisor: createDesktopMcpSupervisor({
						projectRoot: cwd,
						agentDir: resolvedAgentDir,
						debug: readDesktopMcpDebug(cwd, resolvedAgentDir),
					}),
					resultPolicy: resultArtifacts.mcpToolResultPolicy,
					taskCoordinator: mcpTaskCoordinator,
					appHost: mcpAppHost,
				});
			},
			resolveMcpRuntimeScope: ({ cwd, agentDir }) => ({
				cwd: resolveSessionListCwd(cwd),
				agentDir,
			}),
		});
	const runtime = new RuntimeHost({
		...platformServices,
		getDefaultExecutionMode,
		linuxBubblewrapPath,
		macosSandboxExecPath,
		sandboxHostPath,
		serverUrl: DEFAULT_SERVER_URL,
		observationPort: {
			record: (record) => observationHub.record(record),
			flush: () => observationHub.flush(),
			close: async () => {
				await observationHub.close();
				await traceRecorder.close();
			},
		},
		createSessionBackend: ({ agents, observationPublisher }) => {
			publishCodingAgentExecutionRuntimeDefinition(agents);
			const runtimeBackendPool = createRuntimeBackendPool(agents, observationPublisher);
			void runtimeBackendPool.prewarmMcp({ cwd: DEFAULT_CONVERSATION_CWD }).catch((error: unknown) => {
				log.warn("[agent-runtime] default conversation MCP prewarm failed", error);
			});
			const historicalSessionImportBackend = new DesktopHistoricalSessionImportBackend(runtimeBackendPool);
			return new CatalogRoutedRuntimeHostSessionBackend({
				defaultBackend: runtimeBackendPool,
				defaultRouteId: "runtime",
				routes: [
					{
						id: "historical-session-import",
						catalog: historicalFormat.sessionCatalog,
						backend: historicalSessionImportBackend,
					},
					{ id: "runtime", catalog: desktopRuntimeCatalog, backend: runtimeBackendPool },
				],
				onRoute: logSessionRoute,
				dispose: () => runtimeBackendPool.dispose(),
			});
		},
		sessionCatalog: new CompositeRuntimeSessionCatalog(
			[historicalFormat.sessionCatalog, conversationCatalog],
			platformServices.pathServices.normalize,
		),
		sessionFileHistoryReader: new CompositeRuntimeSessionFileHistoryReader([
			historicalFormat.sessionFileHistoryReader,
			new FileConversationRuntimeSessionFileHistoryReader(),
		]),
		sessionAccessResolver: new CatalogRoutedRuntimeSessionAccessResolver([
			{
				catalog: historicalFormat.sessionCatalog,
				access: {
					readHistory: true,
					resume: true,
					rename: true,
					delete: true,
				},
			},
			{
				catalog: imConversationCatalog,
				access: {
					readHistory: true,
					resume: false,
					rename: true,
					delete: true,
				},
			},
			{
				catalog: desktopRuntimeCatalog,
				access: {
					readHistory: true,
					resume: true,
					rename: true,
					delete: true,
				},
			},
		]),
		sharedModelController: createCodingAgentSharedModelController(modelRuntime),
		sessionErrorObserver: (event) => logRuntimeSessionError(event, log),
		sessionCompactionObserver: createRuntimeSessionCompactionLogger(log),
	});
	return { runtime };
}

function logSessionRoute(decision: RuntimeHostSessionBackendRouteDecision): void {
	if (decision.source === "default") {
		log.info(`[agent-runtime] session-route route=${decision.routeId ?? "unknown"} reason=new-session-default`);
		return;
	}
	const reason =
		decision.routeId === "historical-session-import"
			? "historical-session-import"
			: decision.routeId === "runtime"
				? "conversation-v2-catalog"
				: "unknown-catalog";
	log.info(`[agent-runtime] session-route route=${decision.routeId ?? "unknown"} reason=${reason}`);
}
