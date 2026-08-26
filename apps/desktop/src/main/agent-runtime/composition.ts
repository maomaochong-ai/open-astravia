import { join } from "node:path";
import { codingAgentSessionShardPath } from "@vetta/coding-agent/bootstrap";
import {
	CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION,
	createCodingAgentMemoryRolloverRuntime,
	publishCodingAgentExecutionRuntimeDefinition,
} from "@vetta/coding-agent/composition";
import { getAgentDir } from "@vetta/coding-agent/config";
import {
	createCodingAgentMcpRuntimeToolSource,
	createCodingAgentPluginMcpRuntime,
	createCodingAgentSharedModelController,
} from "@vetta/coding-agent/host-services";
import {
	CatalogRoutedRuntimeHostSessionBackend,
	CatalogRoutedRuntimeSessionAccessResolver,
	CompositeRuntimeSessionCatalog,
	CompositeRuntimeSessionFileHistoryReader,
	RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
	RUNTIME_HOST_LIFECYCLE_OBSERVATION,
	type RuntimeAgentRuntime,
	RuntimeHost,
	type RuntimeHostSessionBackendRouteDecision,
	RuntimeObservationHub,
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
import {
	FileConversationRuntimeSessionFileHistoryReader,
	type RuntimeConversationSessionRoot,
} from "@vetta/runtime-node/conversation";
import { createNodeKnowledgeRuntime, NodeTextFileStorage } from "@vetta/runtime-node/host";
import { getModePrompt } from "../agent-modes/index.js";
import { getBuiltinSkillPaths } from "../builtin-skills.js";
import {
	DEFAULT_CONVERSATION_CWD,
	DEFAULT_CONVERSATION_SESSION_DIR,
	DEFAULT_IM_CONVERSATION_CWD,
	DEFAULT_IM_CONVERSATION_SESSION_DIR,
	KB_PROCESSING_CWD,
	KB_PROCESSING_SESSION_DIR,
	readConfigSync,
	readDesktopConfig,
} from "../config/desktop-config-store.js";
import { DEFAULT_SERVER_URL } from "../constants.js";
import { resolveSessionListCwd } from "../conversations/session-paths.js";
import { getDesktopUserQuestionBroker } from "../conversations/user-question-broker.js";
import { getKnowledgeRoot } from "../knowledge/knowledge-layout.js";
import { getAppLogger } from "../logger.js";
import { createDesktopPluginHookAdapterFactory } from "../plugins/coding-agent-hook-adapter.js";
import { pluginAgentContributionService } from "../plugins/plugin-catalog.js";
import { getAvailableLinuxBubblewrapPath, getAvailableMacosSandboxExecPath } from "../sandbox/capability.js";
import { resolveWindowsSandboxHostBinary } from "../sandbox/windows-binary-resolver.js";
import { getOrCreateSharedModelRuntime, readDesktopMcpDebug } from "./host-services.js";
import { createDesktopMcpSupervisor } from "./mcp-supervisor.js";
import { getDesktopProviderObservationRuntime } from "./provider-observation.js";
import { createDesktopPromptRuntimeSources } from "./resource-runtime.js";
import { createRuntimeLifecycleLogPort } from "./runtime-lifecycle-log-port.js";
import { createSessionInitializationLogPort } from "./session-initialization-log-port.js";

const log = getAppLogger("runtime");

export function createDesktopRuntimeComposition(): DesktopRuntimeComposition {
	const observationHub = new RuntimeObservationHub({
		onIssue: (issue) => log.warn("[runtime-observation] application hub issue", issue),
	});
	observationHub.attach(createSessionInitializationLogPort(log), {
		id: "desktop.session-initialization-log",
		domains: [CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION.domain],
	});
	observationHub.attach(createRuntimeLifecycleLogPort(log), {
		id: "desktop.runtime-lifecycle-log",
		domains: [RUNTIME_AGENT_LIFECYCLE_OBSERVATION.domain, RUNTIME_HOST_LIFECYCLE_OBSERVATION.domain],
	});
	const platformServices = createDesktopRuntimeHostPlatformServices();
	const modelRuntime = getOrCreateSharedModelRuntime();
	const providerObservationRuntime = getDesktopProviderObservationRuntime();
	const getDefaultExecutionMode = async () => (await readDesktopConfig()).defaultExecutionMode;
	const sandboxHostPath = resolveWindowsSandboxHostBinary()?.path;
	const linuxBubblewrapPath = getAvailableLinuxBubblewrapPath();
	const macosSandboxExecPath = getAvailableMacosSandboxExecPath();
	const userQuestionHandler = getDesktopUserQuestionBroker().handle;
	const additionalSkillPaths = getBuiltinSkillPaths();
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
	const createRuntimeBackendPool = (agentRuntime: RuntimeAgentRuntime) =>
		new DesktopRuntimeBackendPool({
			compositionDefaults: {
				agentRuntime: { runtime: agentRuntime },
				modelRegistry: modelRuntime,
				createPromptRuntimeSources: createDesktopPromptRuntimeSources,
				// 工作模式注册表归 desktop 所有（ADR-0071 修订）：coding-agent 只保留 core.mode
				// 槽位，正文由这里按会话固化的 agentMode 解析注入。
				resolveModePrompt: getModePrompt,
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
					parent: observationHub,
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
					});
				},
			},
			createHookAdapterFactories: ({ scenario }) => [
				createDesktopPluginHookAdapterFactory({
					scenario,
					canInvoke: (pluginId) => pluginAgentContributionService.canInvokeHook(pluginId),
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
				});
			},
			resolveMcpRuntimeScope: ({ cwd, agentDir }) => ({
				cwd: resolveSessionListCwd(cwd),
				agentDir,
			}),
		});
	const runtime = new RuntimeHost({
		...platformServices,
		additionalSkillPaths,
		getDefaultExecutionMode,
		linuxBubblewrapPath,
		macosSandboxExecPath,
		sandboxHostPath,
		serverUrl: DEFAULT_SERVER_URL,
		observationPort: observationHub,
		createSessionBackend: ({ agents }) => {
			publishCodingAgentExecutionRuntimeDefinition(agents);
			const runtimeBackendPool = createRuntimeBackendPool(agents);
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
					interactiveResume: true,
					rename: true,
					delete: true,
				},
			},
			{
				catalog: imConversationCatalog,
				access: {
					readHistory: true,
					interactiveResume: false,
					rename: true,
					delete: true,
				},
			},
			{
				catalog: desktopRuntimeCatalog,
				access: {
					readHistory: true,
					interactiveResume: true,
					rename: true,
					delete: true,
				},
			},
		]),
		sharedModelController: createCodingAgentSharedModelController(modelRuntime),
		sessionErrorObserver: (event) => logRuntimeSessionError(event, log),
		sessionCompactionObserver: createRuntimeSessionCompactionLogger(log),
		userQuestionHandler,
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

function resolveDesktopRuntimeSessionRoots(): RuntimeConversationSessionRoot[] {
	const config = readConfigSync();
	// 每个项目认两个会话目录：
	// 1. 全局分片目录——新会话的落点（见 backend-pool 的 resolveRuntimeScope）；
	// 2. `<项目>/.vetta/sessions`——存量兼容。会话曾短暂落在这里，直接摘掉会让用户
	//    这段时间的历史从列表里消失。catalog 在未指定 sessionDir 时并集同一 cwd 的
	//    全部 root，所以两处能同时列出来，不需要迁移文件。
	const projectRoots = [...config.projects, ...config.archivedProjects].flatMap(({ path }) => [
		{ cwd: path, sessionDir: codingAgentSessionShardPath(path) },
		{ cwd: path, sessionDir: join(path, ".vetta", "sessions") },
	]);
	return [
		{
			cwd: DEFAULT_CONVERSATION_CWD,
			sessionDir: DEFAULT_CONVERSATION_SESSION_DIR,
		},
		{
			cwd: DEFAULT_IM_CONVERSATION_CWD,
			sessionDir: DEFAULT_IM_CONVERSATION_SESSION_DIR,
		},
		{
			cwd: KB_PROCESSING_CWD,
			sessionDir: KB_PROCESSING_SESSION_DIR,
		},
		...projectRoots,
	];
}
