import { join } from "node:path";
import { getAgentDir } from "@vetta/coding-agent/config";
import {
	createCodingAgentMcpRuntimeToolSource,
	createCodingAgentPluginMcpRuntime,
	createCodingAgentSharedModelController,
} from "@vetta/coding-agent/host-services";
import {
	FileConversationRuntimeSessionFileHistoryReader,
	type RuntimeConversationSessionRoot,
} from "@vetta/runtime-storage/conversation";
import {
	CatalogRoutedRuntimeHostSessionBackend,
	CatalogRoutedRuntimeSessionAccessResolver,
	CompositeRuntimeSessionCatalog,
	CompositeRuntimeSessionFileHistoryReader,
	RuntimeHost,
	type RuntimeHostSessionBackendRouteDecision,
} from "../../../../runtime-core/src/index.js";
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
import { getDesktopUserQuestionBroker } from "../conversations/user-question-broker.js";
import { getAppLogger } from "../logger.js";
import { getAvailableLinuxBubblewrapPath, getAvailableMacosSandboxExecPath } from "../sandbox/capability.js";
import { resolveWindowsSandboxHostBinary } from "../sandbox/windows-binary-resolver.js";
import { getOrCreateSharedModelRuntime, readDesktopMcpDebug } from "./desktop-coding-agent-host-services.js";
import { DesktopGreenfieldRuntimeBackendPool } from "./desktop-greenfield-runtime-backend-pool.js";
import {
	DesktopGreenfieldRuntimeSessionCatalog,
	isSessionPathInDirectory,
	PathFilteredRuntimeSessionCatalog,
} from "./desktop-greenfield-session-catalog.js";
import { DesktopHistoricalSessionImportBackend } from "./desktop-historical-session-import-backend.js";
import { createDesktopLegacySessionFormatCompatibility } from "./desktop-legacy-session-format-compatibility.js";

const log = getAppLogger("runtime");

export interface DesktopRuntimeComposition {
	readonly runtime: RuntimeHost;
	readonly runtimeBackendPool: DesktopGreenfieldRuntimeBackendPool;
}

export function createDesktopRuntimeComposition(): DesktopRuntimeComposition {
	const modelRuntime = getOrCreateSharedModelRuntime();
	const getDefaultExecutionMode = async () => (await readDesktopConfig()).defaultExecutionMode;
	const sandboxHostPath = resolveWindowsSandboxHostBinary()?.path;
	const linuxBubblewrapPath = getAvailableLinuxBubblewrapPath();
	const macosSandboxExecPath = getAvailableMacosSandboxExecPath();
	const userQuestionHandler = getDesktopUserQuestionBroker().handle;
	const additionalSkillPaths = getBuiltinSkillPaths();
	const legacyFormat = createDesktopLegacySessionFormatCompatibility();
	const conversationCatalog = new DesktopGreenfieldRuntimeSessionCatalog({
		resolveRoots: resolveDesktopGreenfieldSessionRoots,
	});
	const imConversationCatalog = new PathFilteredRuntimeSessionCatalog(conversationCatalog, (sessionPath) =>
		isSessionPathInDirectory(sessionPath, DEFAULT_IM_CONVERSATION_SESSION_DIR),
	);
	const desktopGreenfieldCatalog = new PathFilteredRuntimeSessionCatalog(
		conversationCatalog,
		(sessionPath) => !isSessionPathInDirectory(sessionPath, DEFAULT_IM_CONVERSATION_SESSION_DIR),
	);
	const runtimeBackendPool = new DesktopGreenfieldRuntimeBackendPool({
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
		createMcpRuntimeSource: async ({ cwd, agentDir }) => {
			const resolvedAgentDir = agentDir ?? getAgentDir();
			return await createCodingAgentMcpRuntimeToolSource({
				projectRoot: cwd,
				agentDir: resolvedAgentDir,
				debug: readDesktopMcpDebug(cwd, resolvedAgentDir),
				enabled: true,
			});
		},
	});
	const historicalSessionImportBackend = new DesktopHistoricalSessionImportBackend(runtimeBackendPool);
	const sessionBackend = new CatalogRoutedRuntimeHostSessionBackend({
		defaultBackend: runtimeBackendPool,
		defaultRouteId: "runtime",
		routes: [
			{
				id: "historical-session-import",
				catalog: legacyFormat.sessionCatalog,
				backend: historicalSessionImportBackend,
			},
			{ id: "runtime", catalog: desktopGreenfieldCatalog, backend: runtimeBackendPool },
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
			sessionCatalog: new CompositeRuntimeSessionCatalog([legacyFormat.sessionCatalog, conversationCatalog]),
			sessionFileHistoryReader: new CompositeRuntimeSessionFileHistoryReader([
				legacyFormat.sessionFileHistoryReader,
				new FileConversationRuntimeSessionFileHistoryReader(),
			]),
			sessionAccessResolver: new CatalogRoutedRuntimeSessionAccessResolver([
				{
					catalog: legacyFormat.sessionCatalog,
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
					catalog: desktopGreenfieldCatalog,
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
		log.info(`[agent-runtime] session-route backend=${decision.routeId ?? "unknown"} reason=new-session-default`);
		return;
	}
	const reason =
		decision.routeId === "historical-session-import"
			? "historical-session-import"
			: decision.routeId === "runtime"
				? "conversation-v2-catalog"
				: "unknown-catalog";
	log.info(`[agent-runtime] session-route backend=${decision.routeId ?? "unknown"} reason=${reason}`);
}

function resolveDesktopGreenfieldSessionRoots(): RuntimeConversationSessionRoot[] {
	const config = readConfigSync();
	const projectRoots = [...config.projects, ...config.archivedProjects].map(({ path }) => ({
		cwd: path,
		sessionDir: join(path, ".vetta", "sessions"),
	}));
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
