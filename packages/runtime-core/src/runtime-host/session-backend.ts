import type {
	AgentPluginContinuationInvoker,
	AgentPluginRuntimeConfig,
	AgentPluginSystemPromptInvoker,
	AgentPluginToolInvoker,
	RuntimeQuestionItem,
	RuntimeUserQuestionResult,
	SessionConfig,
	SessionExecutionMode,
} from "../contracts.js";
import type {
	RuntimeSessionBackgroundWorkController,
	RuntimeSessionConfigurationController,
	RuntimeSessionCorePorts,
	RuntimeSessionExecutionController,
	RuntimeSessionHistoryController,
	RuntimeSessionHistoryReader,
	RuntimeSessionHostInteraction,
	RuntimeSessionIdentityLifecycle,
	RuntimeSessionMetadataController,
	RuntimeSessionModelController,
	RuntimeSessionModelView,
	RuntimeSessionQueueController,
	RuntimeSessionTodoController,
	RuntimeSessionWorkspaceView,
} from "./session-ports.js";
import type { RuntimeSessionCatalog } from "./session-services.js";

export interface RuntimeSessionAskUserQuestionCapability {
	isEnabled(): boolean;
	ask(request: { questions: RuntimeQuestionItem[] }, signal?: AbortSignal): Promise<RuntimeUserQuestionResult>;
}

/** RuntimeHost 到 Session Backend 的实现无关创建请求。 */
export interface RuntimeSessionCreateRequest {
	readonly cwd?: SessionConfig["cwd"];
	readonly agentDir?: SessionConfig["agentDir"];
	readonly sessionPath?: SessionConfig["sessionPath"];
	readonly sessionDir?: SessionConfig["sessionDir"];
	readonly model?: SessionConfig["model"];
	readonly thinkingLevel?: SessionConfig["thinkingLevel"];
	readonly scenario?: SessionConfig["scenario"];
	readonly agentMode?: SessionConfig["agentMode"];
	readonly executionMode: SessionExecutionMode;
	readonly appendSystemPrompt?: SessionConfig["appendSystemPrompt"];
	readonly env?: SessionConfig["env"];
	readonly enableBackgroundTasks?: SessionConfig["enableBackgroundTasks"];
	readonly enableSubagents: boolean;
	readonly includeAgentSkills?: SessionConfig["includeAgentSkills"];
	readonly agentPlugins?: AgentPluginRuntimeConfig;
	readonly invokePluginTool?: AgentPluginToolInvoker;
	readonly invokePluginContinuation?: AgentPluginContinuationInvoker;
	readonly invokePluginSystemPrompt?: AgentPluginSystemPromptInvoker;
	readonly askUserQuestion?: RuntimeSessionAskUserQuestionCapability;
	readonly serverUrl?: string;
	readonly sandboxHostPath?: string;
	readonly linuxBubblewrapPath?: string;
	readonly macosSandboxExecPath?: string;
	readonly getSessionId: () => string | undefined;
}

/**
 * 会话创建后端的通用工厂边界。
 */
export interface RuntimeSessionBackend<TCreateOptions, TSession> {
	create(options: TCreateOptions): Promise<TSession>;
}

export interface RuntimeHostSessionAssembly {
	readonly lifecycle: RuntimeSessionIdentityLifecycle;
	readonly historyReader: RuntimeSessionHistoryReader;
	readonly historyController: RuntimeSessionHistoryController;
	readonly hostInteraction: RuntimeSessionHostInteraction;
	readonly executionController: RuntimeSessionExecutionController;
	readonly workspaceView: RuntimeSessionWorkspaceView;
	readonly backgroundWorkController: RuntimeSessionBackgroundWorkController;
	readonly todoController: RuntimeSessionTodoController;
	readonly configurationController: RuntimeSessionConfigurationController;
	readonly modelController: RuntimeSessionModelController;
	readonly modelView: RuntimeSessionModelView;
	readonly corePorts: RuntimeSessionCorePorts;
	/** 可选能力（ADR-0060）：缺失时 RuntimeHost 相应功能静默降级，不做 no-op 伪造。 */
	readonly queueController?: RuntimeSessionQueueController;
	readonly metadataController?: RuntimeSessionMetadataController;
}

export const RUNTIME_HOST_SESSION_PORT_NAMES = [
	"lifecycle",
	"historyReader",
	"historyController",
	"hostInteraction",
	"executionController",
	"workspaceView",
	"backgroundWorkController",
	"todoController",
	"configurationController",
	"modelController",
	"modelView",
	"corePorts",
] as const satisfies readonly (keyof RuntimeHostSessionAssembly)[];

export type RuntimeHostSessionPortName = (typeof RUNTIME_HOST_SESSION_PORT_NAMES)[number];

export type RuntimeHostSessionAssemblyCandidate = Partial<RuntimeHostSessionAssembly>;

export type RuntimeHostSessionAssemblyAssessment =
	| {
			readonly ready: true;
			readonly assembly: RuntimeHostSessionAssembly;
			readonly missingPorts: readonly [];
	  }
	| {
			readonly ready: false;
			readonly missingPorts: readonly RuntimeHostSessionPortName[];
	  };

/**
 * 检查组合根是否交付了 RuntimeHost 所需的完整 Session Port。
 *
 * 这是受信任进程内对象的组合完整性门禁，不负责解析外部 JSON，也不替代各 Port
 * 自身的行为合同。
 */
export function assessRuntimeHostSessionAssembly(
	candidate: RuntimeHostSessionAssemblyCandidate,
): RuntimeHostSessionAssemblyAssessment {
	const missingPorts = RUNTIME_HOST_SESSION_PORT_NAMES.filter((name) => candidate[name] === undefined);
	if (missingPorts.length > 0) return { ready: false, missingPorts };
	return {
		ready: true,
		assembly: candidate as RuntimeHostSessionAssembly,
		missingPorts: [],
	};
}

/** RuntimeHost 的组合根合同：一次创建同时交付外围句柄与基础能力 Port。 */
export interface RuntimeHostSessionBackend {
	createAssembly(request: RuntimeSessionCreateRequest): Promise<RuntimeHostSessionAssembly>;
}

export interface RuntimeHostSessionBackendRoute {
	/** 供宿主诊断使用的稳定路由标识；不参与路由判断。 */
	readonly id?: string;
	readonly catalog: RuntimeSessionCatalog;
	readonly backend: RuntimeHostSessionBackend;
}

export interface RuntimeHostSessionBackendRouteDecision {
	readonly routeId: string | undefined;
	readonly source: "default" | "catalog";
}

export interface CatalogRoutedRuntimeHostSessionBackendOptions {
	/** 无 sessionPath 的新会话使用该 Backend。 */
	readonly defaultBackend: RuntimeHostSessionBackend;
	/** 供宿主诊断使用的默认路由标识。 */
	readonly defaultRouteId?: string;
	/** 既有会话必须由 Catalog 明确认领后才能路由。 */
	readonly routes: readonly RuntimeHostSessionBackendRoute[];
	/** 成功选出后端后、创建 Assembly 前触发；不承载日志或遥测实现。 */
	readonly onRoute?: (decision: RuntimeHostSessionBackendRouteDecision) => void;
}

/**
 * 根据持久化格式归属选择 Session Backend。
 *
 * 新会话只走显式 defaultBackend；既有路径禁止回退到默认实现，避免一个 Backend
 * 误读另一个 Backend 的持久化格式。
 */
export class CatalogRoutedRuntimeHostSessionBackend implements RuntimeHostSessionBackend {
	private readonly defaultBackend: RuntimeHostSessionBackend;
	private readonly defaultRouteId: string | undefined;
	private readonly routes: readonly RuntimeHostSessionBackendRoute[];
	private readonly onRoute: ((decision: RuntimeHostSessionBackendRouteDecision) => void) | undefined;

	constructor(options: CatalogRoutedRuntimeHostSessionBackendOptions) {
		if (options.routes.length === 0) {
			throw new Error("CatalogRoutedRuntimeHostSessionBackend requires at least one route");
		}
		this.defaultBackend = options.defaultBackend;
		this.defaultRouteId = options.defaultRouteId;
		this.routes = options.routes;
		this.onRoute = options.onRoute;
	}

	async createAssembly(request: RuntimeSessionCreateRequest): Promise<RuntimeHostSessionAssembly> {
		const sessionPath = request.sessionPath?.trim();
		if (!sessionPath) {
			this.onRoute?.({ routeId: this.defaultRouteId, source: "default" });
			return this.defaultBackend.createAssembly(request);
		}

		for (const route of this.routes) {
			if (await route.catalog.ownsSession(sessionPath)) {
				this.onRoute?.({ routeId: route.id, source: "catalog" });
				return route.backend.createAssembly(request);
			}
		}
		throw new Error(`No RuntimeHost session backend owns ${sessionPath}`);
	}
}
