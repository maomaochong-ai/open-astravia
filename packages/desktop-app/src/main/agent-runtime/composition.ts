import { join } from "node:path";
import { codingAgentSessionShardPath } from "@vetta/coding-agent/bootstrap";
import { getAgentDir } from "@vetta/coding-agent/config";
import {
	createCodingAgentMcpRuntimeToolSource,
	createCodingAgentPluginMcpRuntime,
	createCodingAgentSessionArtifactCleaner,
	createCodingAgentSharedModelController,
} from "@vetta/coding-agent/host-services";
import {
	CatalogRoutedRuntimeHostSessionBackend,
	CatalogRoutedRuntimeSessionAccessResolver,
	CompositeRuntimeSessionCatalog,
	CompositeRuntimeSessionFileHistoryReader,
	RuntimeHost,
	type RuntimeHostSessionBackendRouteDecision,
} from "@vetta/runtime-core";
import {
	FileConversationRuntimeSessionFileHistoryReader,
	type RuntimeConversationSessionRoot,
} from "@vetta/runtime-storage/conversation";
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
import { getAppLogger } from "../logger.js";
import { createDesktopPluginHookAdapterFactory } from "../plugins/coding-agent-hook-adapter.js";
import { canInvokeDynamicAgentHook, readPluginRuntimeAgentMode } from "../plugins/plugin-store.js";
import { getAvailableLinuxBubblewrapPath, getAvailableMacosSandboxExecPath } from "../sandbox/capability.js";
import { resolveWindowsSandboxHostBinary } from "../sandbox/windows-binary-resolver.js";
import { DesktopRuntimeBackendPool } from "./backend-pool.js";
import { createDesktopHistoricalSessionFormat } from "./historical-session-format.js";
import { DesktopHistoricalSessionImportBackend } from "./historical-session-import-backend.js";
import { getOrCreateSharedModelRuntime, readDesktopMcpDebug } from "./host-services.js";
import {
	DesktopRuntimeSessionCatalog,
	isSessionPathInDirectory,
	PathFilteredRuntimeSessionCatalog,
} from "./session-catalog.js";

const log = getAppLogger("runtime");

export interface DesktopRuntimeComposition {
	readonly runtime: RuntimeHost;
	readonly runtimeBackendPool: DesktopRuntimeBackendPool;
}

export function createDesktopRuntimeComposition(): DesktopRuntimeComposition {
	const modelRuntime = getOrCreateSharedModelRuntime();
	const getDefaultExecutionMode = async () => (await readDesktopConfig()).defaultExecutionMode;
	const sandboxHostPath = resolveWindowsSandboxHostBinary()?.path;
	const linuxBubblewrapPath = getAvailableLinuxBubblewrapPath();
	const macosSandboxExecPath = getAvailableMacosSandboxExecPath();
	const userQuestionHandler = getDesktopUserQuestionBroker().handle;
	const additionalSkillPaths = getBuiltinSkillPaths();
	const historicalFormat = createDesktopHistoricalSessionFormat();
	const conversationCatalog = new DesktopRuntimeSessionCatalog({
		resolveRoots: resolveDesktopRuntimeSessionRoots,
		artifactCleaner: createCodingAgentSessionArtifactCleaner(getAgentDir()),
	});
	const imConversationCatalog = new PathFilteredRuntimeSessionCatalog(conversationCatalog, (sessionPath) =>
		isSessionPathInDirectory(sessionPath, DEFAULT_IM_CONVERSATION_SESSION_DIR),
	);
	const desktopRuntimeCatalog = new PathFilteredRuntimeSessionCatalog(
		conversationCatalog,
		(sessionPath) => !isSessionPathInDirectory(sessionPath, DEFAULT_IM_CONVERSATION_SESSION_DIR),
	);
	const runtimeBackendPool = new DesktopRuntimeBackendPool({
		compositionDefaults: {
			modelRegistry: modelRuntime,
			createPluginMcpRuntime: ({ cwd, agentDir }) => {
				const resolvedAgentDir = agentDir ?? getAgentDir();
				return createCodingAgentPluginMcpRuntime({
					agentDir: resolvedAgentDir,
					debug: readDesktopMcpDebug(cwd, resolvedAgentDir),
				});
			},
		},
		createHookAdapterFactories: ({ scenario }) => [
			createDesktopPluginHookAdapterFactory({
				scenario,
				readAgentMode: readPluginRuntimeAgentMode,
				canInvoke: canInvokeDynamicAgentHook,
			}),
		],
		createMcpRuntimeSource: async ({ cwd, agentDir }) => {
			const resolvedAgentDir = agentDir ?? getAgentDir();
			return await createCodingAgentMcpRuntimeToolSource({
				projectRoot: cwd,
				agentDir: resolvedAgentDir,
				debug: readDesktopMcpDebug(cwd, resolvedAgentDir),
				enabled: true,
			});
		},
		resolveMcpRuntimeScope: ({ cwd, agentDir }) => ({
			cwd: resolveSessionListCwd(cwd),
			agentDir,
		}),
	});
	void runtimeBackendPool.prewarmMcp({ cwd: DEFAULT_CONVERSATION_CWD }).catch((error: unknown) => {
		log.warn("[agent-runtime] default conversation MCP prewarm failed", error);
	});
	const historicalSessionImportBackend = new DesktopHistoricalSessionImportBackend(runtimeBackendPool);
	const sessionBackend = new CatalogRoutedRuntimeHostSessionBackend({
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
	});
	return {
		runtimeBackendPool,
		runtime: new RuntimeHost({
			additionalSkillPaths,
			getDefaultExecutionMode,
			linuxBubblewrapPath,
			macosSandboxExecPath,
			sandboxHostPath,
			serverUrl: DEFAULT_SERVER_URL,
			sessionBackend,
			sessionCatalog: new CompositeRuntimeSessionCatalog([historicalFormat.sessionCatalog, conversationCatalog]),
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
			userQuestionHandler,
		}),
	};
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
