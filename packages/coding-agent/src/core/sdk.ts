import { join } from "node:path";
import { Agent, type AgentMessage, type ThinkingLevel } from "@vetta/agent-core";
import type { Message, Model } from "@vetta/ai";
import { buildDefaultHookConfigLayers } from "@vetta/ecosystem-adapter";
import type { RuntimeTracer } from "@vetta/runtime-telemetry";
import { createLangfuseRuntimeTracerFromEnv } from "@vetta/runtime-telemetry/langfuse";
import { DEFAULT_SERVER_URL, ENV_SERVER_URL, getAgentDir, getDocsPath, getVettaHomePath } from "../config.js";
import { AgentSession } from "./agent-session.js";
import { AuthStorage } from "./auth-storage.js";
import { DEFAULT_THINKING_LEVEL } from "./defaults.js";
import type { ExtensionRunner, LoadExtensionsResult, ToolDefinition } from "./extensions/index.js";
import type { EcosystemHookAdapterFactory } from "./hooks/index.js";
import { applyImageBudget } from "./image-budget.js";
import { convertToLlm } from "./messages.js";
import { ModelRegistry } from "./model-registry.js";
import { findInitialModel } from "./model-resolver.js";
import type { ResourceLoader } from "./resource-loader.js";
import { DefaultResourceLoader } from "./resource-loader.js";
import type { ConversationScenario } from "./session/tool-scope.js";
import { SessionManager } from "./session-manager/index.js";
import { SettingsManager } from "./settings-manager.js";
import {
	createDefaultSubagentSessionFactory,
	createDefaultSubagentTypeRegistry,
	type SubagentSessionFactory,
	type SubagentTypeRegistry,
} from "./subagents/index.js";
import type {
	AgentPluginContinuationInvoker,
	AgentPluginRuntimeConfig,
	AgentPluginSystemPromptInvoker,
	AgentPluginToolInvoker,
} from "./system-prompt.js";
import { time } from "./timings.js";
import {
	type AskUserQuestionCapability,
	allTools,
	bashTool,
	codingTools,
	createBashTool,
	createCodingTools,
	createEditTool,
	createExtractTextFromImgTool,
	createExtractTextFromPdfTool,
	createFindTool,
	createGlobTool,
	createGrepTool,
	createHtmlToPdfTool,
	createKbFilterByTagsTool,
	createKbListTagsTool,
	createKbWritePageTool,
	createLsTool,
	createProgressTool,
	createReadOnlyTools,
	createReadTool,
	createRenderPdfPageTool,
	createShellTool,
	createTreeTool,
	createWriteTool,
	editTool,
	extractTextFromImgTool,
	extractTextFromPdfTool,
	findTool,
	globTool,
	grepTool,
	htmlToPdfTool,
	kbFilterByTagsTool,
	kbListTagsTool,
	kbWritePageTool,
	lsTool,
	progressTool,
	readOnlyTools,
	readTool,
	renderPdfPageTool,
	shellTool,
	type Tool,
	type ToolName,
	treeTool,
	writeTool,
} from "./tools/index.js";

export interface CreateAgentSessionOptions {
	/** Working directory for project-local discovery. Default: process.cwd() */
	cwd?: string;
	/** Global config directory. Default: ~/.pi/agent */
	agentDir?: string;

	/** Auth storage for credentials. Default: AuthStorage.create(agentDir/auth.json) */
	authStorage?: AuthStorage;
	/** Model registry. Default: new ModelRegistry(authStorage, agentDir/models.json) */
	modelRegistry?: ModelRegistry;

	/** Model to use. Default: from settings, else first available */
	model?: Model<any>;
	/** Thinking level. Default: from settings, else 'medium' (clamped to model capabilities) */
	thinkingLevel?: ThinkingLevel;
	/** Models available for cycling (Ctrl+P in interactive mode) */
	scopedModels?: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>;

	/** Built-in tools to use. Default: codingTools [read, command-tool, edit, write, dir_tree, doc_to_pdf, html_to_pdf, extract_text_from_pdf, extract_text_from_img, render_pdf_page] */
	tools?: Tool[];
	/**
	 * 对话场景：决定按 scope_use 激活哪些工具（隔离的唯一轴）。不传则用 DEFAULT_SCENARIO("cli")，
	 * 即裸 CLI/SDK fallback（≈全开）。desktop 各入口按场景显式传入。
	 */
	scenario?: ConversationScenario;
	/** 工作模式（agent_mode 正交轴）。不传=不按模式过滤（CLI/headless）。见 ADR-0046。 */
	agentMode?: string;
	/** Custom tools to register (in addition to built-in tools). */
	customTools?: ToolDefinition[];
	/** Additional external-ecosystem Hook adapters composed with built-in adapters. */
	additionalHookAdapterFactories?: readonly EcosystemHookAdapterFactory[];

	/** Resource loader. When omitted, DefaultResourceLoader is used. */
	resourceLoader?: ResourceLoader;

	/** Session manager. Default: SessionManager.create(cwd) */
	sessionManager?: SessionManager;

	/** Settings manager. Default: SettingsManager.create(cwd, agentDir) */
	settingsManager?: SettingsManager;

	/** 追加到 system prompt 末尾的文本，不会被上下文压缩 */
	appendSystemPrompt?: string;

	/**
	 * 是否发现通用 Agent Skill 目录（`~/.agents/skills`、`<cwd>/.agents/skills`）。默认 true。
	 * 仅在未显式传入 resourceLoader 时生效（由 DefaultResourceLoader 消费）。
	 */
	includeAgentSkills?: boolean;

	/**
	 * 注入到 bash/shell 工具子进程的环境变量覆盖层。仅对该 session 内的命令执行生效；
	 * 不传则行为等同旧版。常用于将 TMPDIR/TEMP/TMP 重定向到 session 私有目录。
	 */
	env?: Record<string, string>;

	/**
	 * memory-mode（ADR-0009）：启用 MEMORY.md 跨会话记忆注入 + memory 工具 +
	 * session rollover + 日期工作史。仅 im-gateway 为 Claw cwd 启用。
	 */
	memoryMode?: boolean;
	/** MEMORY.md 绝对路径（run cwd 无关）。memoryMode 下不传则默认 <cwd>/MEMORY.md。 */
	memoryFile?: string;
	/** MEMORY.md 字符预算（默认 DEFAULT_MEMORY_CHAR_LIMIT）。 */
	memoryCharLimit?: number;

	/**
	 * 宿主提供的「向用户提问」能力，作为 ask_user_question 工具的后端。不传则工具不注册。
	 * `isEnabled()` 在每个 prompt 入口被实时读取，故宿主可动态启停而无需重建 session。
	 */
	askUserQuestion?: AskUserQuestionCapability;

	/**
	 * 是否启用后台 bash 任务（run_in_background）。默认 true。
	 * 按 session 生命周期编排执行的宿主（如桌面批量任务）应置 false。
	 */
	enableBackgroundTasks?: boolean;

	/**
	 * Enable subagent coordinator + control tools. Fail-closed default: false.
	 * Desktop/CLI conversation|project|cli should pass true when product-ready.
	 * Child sessions must leave this false.
	 */
	enableSubagents?: boolean;
	/** Override type registry (default explorer-only when enableSubagents). */
	subagentTypeRegistry?: SubagentTypeRegistry;
	/** Override child session factory (desktop injects sandbox-aware factory). */
	subagentSessionFactory?: SubagentSessionFactory;
	/** Max concurrent pending/running children (default 3). */
	subagentMaxConcurrent?: number;
	/** Disable MCP manager on this session (child sessions pass false). Default true. */
	enableMcp?: boolean;

	/**
	 * Vetta 远端服务 URL（拉取 remote models / providers）。当宿主进程已经从环境
	 * 变量解析出权威值（例如 desktop-app 的 VETTA_SERVER_URL）时显式传入，避免
	 * SDK 退回到内置的 LAN 默认值并把它持久化到 settings.json，造成 desktop-app
	 * 与 coding-agent SDK 各自指向不同 server 的"半边大脑"问题。
	 * 不传则保留旧行为：先读 settings.json，再回退到内置 DEFAULT_SERVER_URL，
	 * 并把内置值写入 settings.json 以便下次复用。
	 */
	serverUrl?: string;

	/**
	 * Optional platform-neutral tracer. If omitted, VETTA_TRACING=langfuse enables Langfuse.
	 */
	tracer?: RuntimeTracer;

	/** Trace name shown in Langfuse trace lists. */
	tracingTraceName?: string;

	/** Extra metadata propagated to tracing observations. */
	tracingMetadata?: Record<string, unknown>;

	/** Runtime plugin contributions applied while building agent prompts/resources. */
	agentPlugins?: AgentPluginRuntimeConfig;
	/** Host bridge used by plugin-contributed tools. */
	invokePluginTool?: AgentPluginToolInvoker;
	/** Host bridge used by plugin continuation providers. */
	invokePluginContinuation?: AgentPluginContinuationInvoker;
	/** Host bridge used by dynamic system prompt providers. */
	invokePluginSystemPrompt?: AgentPluginSystemPromptInvoker;
}

/** Result from createAgentSession */
export interface CreateAgentSessionResult {
	/** The created session */
	session: AgentSession;
	/** Extensions result (for UI context setup in interactive mode) */
	extensionsResult: LoadExtensionsResult;
	/** Warning if session was restored with a different model than saved */
	modelFallbackMessage?: string;
}

// Re-exports

export type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionFactory,
	SlashCommandInfo,
	SlashCommandLocation,
	SlashCommandSource,
	ToolDefinition,
} from "./extensions/index.js";
export type { PromptTemplate } from "./prompt-templates.js";
export type { Skill, SkillType } from "./skills.js";
export type { Tool } from "./tools/index.js";

export {
	allTools as allBuiltInTools,
	bashTool,
	shellTool,
	codingTools,
	createBashTool,
	createShellTool,
	// Tool factories (for custom cwd)
	createCodingTools,
	createEditTool,
	createExtractTextFromImgTool,
	createExtractTextFromPdfTool,
	createFindTool,
	createGlobTool,
	createGrepTool,
	createHtmlToPdfTool,
	createLsTool,
	createProgressTool,
	createReadOnlyTools,
	createReadTool,
	createRenderPdfPageTool,
	createTreeTool,
	createWriteTool,
	// Knowledge base tool factories
	createKbWritePageTool,
	createKbFilterByTagsTool,
	createKbListTagsTool,
	editTool,
	extractTextFromImgTool,
	extractTextFromPdfTool,
	findTool,
	globTool,
	grepTool,
	htmlToPdfTool,
	lsTool,
	progressTool,
	readOnlyTools,
	// Pre-built tools (use process.cwd())
	readTool,
	renderPdfPageTool,
	treeTool,
	writeTool,
	// Knowledge base pre-built tools
	kbWritePageTool,
	kbFilterByTagsTool,
	kbListTagsTool,
};

// Helper Functions

function getDefaultAgentDir(): string {
	return getAgentDir();
}

/**
 * Create an AgentSession with the specified options.
 *
 * @example
 * ```typescript
 * // Minimal - uses defaults
 * const { session } = await createAgentSession();
 *
 * // With explicit model
 * import { getModel } from '@vetta/ai';
 * const { session } = await createAgentSession({
 *   model: getModel('anthropic', 'claude-opus-4-5'),
 *   thinkingLevel: 'high',
 * });
 *
 * // Continue previous session
 * const { session, modelFallbackMessage } = await createAgentSession({
 *   continueSession: true,
 * });
 *
 * // Full control
 * const loader = new DefaultResourceLoader({
 *   cwd: process.cwd(),
 *   agentDir: getAgentDir(),
 *   settingsManager: SettingsManager.create(),
 * });
 * await loader.reload();
 * const { session } = await createAgentSession({
 *   model: myModel,
 *   tools: [readTool, bashTool],
 *   resourceLoader: loader,
 *   sessionManager: SessionManager.inMemory(),
 * });
 * ```
 */
export async function createAgentSession(options: CreateAgentSessionOptions = {}): Promise<CreateAgentSessionResult> {
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getDefaultAgentDir();
	let resourceLoader = options.resourceLoader;

	// Use provided or create AuthStorage and ModelRegistry
	const authPath = options.agentDir ? join(agentDir, "auth.json") : undefined;
	const modelsPath = options.agentDir ? join(agentDir, "models.json") : undefined;
	const authStorage = options.authStorage ?? AuthStorage.create(authPath);
	const modelRegistry = options.modelRegistry ?? new ModelRegistry(authStorage, modelsPath);

	const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
	// Ensure serverUrl has a default value, then load remote models.
	// 优先级：调用方显式传入 > settings.json > 内置 DEFAULT_SERVER_URL。
	// 调用方传入的 URL 不写入 settings.json——宿主进程（如 desktop-app）才是
	// 权威来源，settings 里的残留值由宿主自行清理（参考 desktop-app
	// registerSettingsIpc 启动时的 scrub 逻辑）。
	if (!options.modelRegistry) {
		// 同 main.ts：环境变量（宿主注入）优先于 settings.json，避免子进程
		// 读到陈旧的 LAN 地址。详见 main.ts 中的 serverUrl 注释。
		let serverUrl = options.serverUrl ?? process.env[ENV_SERVER_URL] ?? settingsManager.getServerUrl();
		let writeBackDefault = false;
		if (!serverUrl) {
			serverUrl = DEFAULT_SERVER_URL;
			writeBackDefault = options.serverUrl === undefined;
		}
		if (writeBackDefault) {
			settingsManager.setServerUrl(serverUrl);
		}
		modelRegistry.setServerUrl(serverUrl);
		modelRegistry.setServerToken(settingsManager.getServerToken());
		modelRegistry.setServerTokenGetter(() => settingsManager.getServerTokenFresh());
		await modelRegistry.loadRemoteModels();
	}
	const sessionManager = options.sessionManager ?? SessionManager.create(cwd);
	const tracer = options.tracer ?? createLangfuseRuntimeTracerFromEnv();

	if (!resourceLoader) {
		const pluginSkillPaths =
			options.agentPlugins?.skillPathContributions?.flatMap((contribution) => contribution.paths) ?? [];
		resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			appendSystemPrompt: options.appendSystemPrompt,
			includeAgentSkills: options.includeAgentSkills,
			additionalSkillPaths: pluginSkillPaths,
		});
		await resourceLoader.reload();
		time("resourceLoader.reload");
	}
	// Check if session has existing data to restore
	const existingSession = sessionManager.buildSessionContext();
	const hasExistingSession = existingSession.messages.length > 0;
	const hasThinkingEntry = sessionManager.getBranch().some((entry) => entry.type === "thinking_level_change");

	let model = options.model;
	let modelFallbackMessage: string | undefined;

	// If session has data, try to restore model from it
	if (!model && hasExistingSession && existingSession.model) {
		const storedProvider = existingSession.model.provider;
		const storedId = existingSession.model.modelId;
		// 先按 id(=路由 key) 精确匹配；匹配不到再按上游真名 modelId 兜底(兼容老会话存的旧 modelId)
		const restoredModel =
			modelRegistry.find(storedProvider, storedId) ??
			modelRegistry.getAll().find((m) => m.provider === storedProvider && m.modelId === storedId);
		if (restoredModel && (await modelRegistry.getApiKey(restoredModel))) {
			model = restoredModel;
			// 走 modelId 兜底命中(id !== storedId)：把会话存储里的标识静默升级为精确 key，确保下次请求走精确路由
			if (restoredModel.id !== storedId) {
				sessionManager.appendModelChange(restoredModel.provider, restoredModel.id);
			}
		}
		if (!model) {
			modelFallbackMessage = `Could not restore model ${storedProvider}/${storedId}`;
		}
	}

	// If still no model, use findInitialModel (checks settings default, then provider defaults)
	if (!model) {
		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: hasExistingSession,
			defaultProvider: settingsManager.getDefaultProvider(),
			defaultModelId: settingsManager.getDefaultModel(),
			defaultThinkingLevel: settingsManager.getDefaultThinkingLevel(),
			modelRegistry,
		});
		model = result.model;
		if (!model) {
			modelFallbackMessage = `No models available. Use /login or set an API key environment variable. See ${join(getDocsPath(), "providers.md")}. Then use /model to select a model.`;
		} else if (modelFallbackMessage) {
			modelFallbackMessage += `. Using ${model.provider}/${model.id}`;
		}
	}

	let thinkingLevel = options.thinkingLevel;

	// If session has data, restore thinking level from it
	if (thinkingLevel === undefined && hasExistingSession) {
		thinkingLevel = hasThinkingEntry
			? (existingSession.thinkingLevel as ThinkingLevel)
			: (settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL);
	}

	// Fall back to settings default
	if (thinkingLevel === undefined) {
		thinkingLevel = settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
	}

	// Clamp to model capabilities
	if (!model?.reasoning) {
		thinkingLevel = "off";
	}

	// 显式传 tools（含 --no-tools 的空数组）→ 走「调用方指定工具」模式（RuntimeManager 据此
	// 直接用这份名单，不做场景解析）；不传则留 undefined → 走 scenario 驱动的 scope_use 解析。
	const initialActiveToolNames: ToolName[] | undefined = options.tools
		? options.tools.map((t) => t.name).filter((n): n is ToolName => n in allTools)
		: undefined;

	let agent: Agent;

	// Create convertToLlm wrapper that filters images if blockImages is enabled (defense-in-depth)
	const convertToLlmWithBlockImages = (messages: AgentMessage[]): Message[] => {
		const converted = convertToLlm(messages);
		// Check setting dynamically so mid-session changes take effect
		if (!settingsManager.getBlockImages()) {
			return converted;
		}
		// Filter out ImageContent from all messages, replacing with text placeholder
		return converted.map((msg) => {
			if (msg.role === "user" || msg.role === "toolResult") {
				const content = msg.content;
				if (Array.isArray(content)) {
					const hasImages = content.some((c) => c.type === "image");
					if (hasImages) {
						const filteredContent = content
							.map((c) =>
								c.type === "image" ? { type: "text" as const, text: "Image reading is disabled." } : c,
							)
							.filter(
								(c, i, arr) =>
									// Dedupe consecutive "Image reading is disabled." texts
									!(
										c.type === "text" &&
										c.text === "Image reading is disabled." &&
										i > 0 &&
										arr[i - 1].type === "text" &&
										(arr[i - 1] as { type: "text"; text: string }).text === "Image reading is disabled."
									),
							);
						return { ...msg, content: filteredContent };
					}
				}
			}
			return msg;
		});
	};

	const extensionRunnerRef: { current?: ExtensionRunner } = {};
	const agentSessionRef: { current?: AgentSession } = {};

	agent = new Agent({
		initialState: {
			systemPrompt: "",
			model,
			thinkingLevel,
			tools: [],
		},
		convertToLlm: convertToLlmWithBlockImages,
		// gpt-5.x 会把这两个无副作用工具的参数写成正文而不发起真实调用（work 模式的
		// progress 阶段标题、todo 的状态更新都会因此丢失），在 loop 里还原成调用。
		salvageTextToolCalls: ["progress", "todo"],
		sessionId: sessionManager.getSessionId(),
		transformContext: async (messages, signal) => {
			const runner = extensionRunnerRef.current;
			if (runner) {
				messages = await runner.emitContext(messages);
			}
			const session = agentSessionRef.current;
			if (session) {
				messages = await session.preCallCompaction(messages, signal);
			}
			// Cap session-wide image count to bound visual-token cost for VL models.
			// Read setting dynamically so mid-session changes take effect.
			messages = applyImageBudget(messages, settingsManager.getMaxRecentImages());
			return messages;
		},
		steeringMode: settingsManager.getSteeringMode(),
		followUpMode: settingsManager.getFollowUpMode(),
		transport: settingsManager.getTransport(),
		thinkingBudgets: settingsManager.getThinkingBudgets(),
		maxRetryDelayMs: settingsManager.getRetrySettings().maxDelayMs,
		tracer,
		tracing: {
			captureContent: true,
			detail: "standard",
			traceName: options.tracingTraceName ?? process.env.VETTA_TRACING_TRACE_NAME ?? "coding-agent run",
			metadata: {
				...options.tracingMetadata,
				app: "coding-agent",
				cwd,
				sessionId: sessionManager.getSessionId(),
			},
		},
		getApiKey: async (provider) => {
			// Use the provider argument from the in-flight request;
			// agent.state.model may already be switched mid-turn.
			const resolvedProvider = provider || agent.state.model?.provider;
			if (!resolvedProvider) {
				throw new Error("No model selected");
			}
			const key = await modelRegistry.getApiKeyForProvider(resolvedProvider);
			if (!key) {
				const model = agent.state.model;
				const isOAuth = model && modelRegistry.isUsingOAuth(model);
				if (isOAuth) {
					throw new Error(
						`Authentication failed for "${resolvedProvider}". ` +
							`Credentials may have expired or network is unavailable. ` +
							`Run '/login ${resolvedProvider}' to re-authenticate.`,
					);
				}
				throw new Error(
					`No API key found for "${resolvedProvider}". ` +
						`Set an API key environment variable or run '/login ${resolvedProvider}'.`,
				);
			}
			return key;
		},
	});

	// Restore messages if session has existing data
	if (hasExistingSession) {
		agent.replaceMessages(existingSession.messages);
		if (!hasThinkingEntry) {
			sessionManager.appendThinkingLevelChange(thinkingLevel);
		}
	} else {
		// Save initial model and thinking level for new sessions so they can be restored on resume
		if (model) {
			sessionManager.appendModelChange(model.provider, model.id);
		}
		sessionManager.appendThinkingLevelChange(thinkingLevel);
	}

	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd,
		scopedModels: options.scopedModels,
		resourceLoader,
		customTools: options.customTools,
		additionalHookAdapterFactories: options.additionalHookAdapterFactories,
		// Vetta-nested .codex/.claude only; does not read top-level ~/.codex / ~/.claude.
		hookConfigLayers: buildDefaultHookConfigLayers({ cwd, vettaHome: getVettaHomePath() }),
		modelRegistry,
		scenario: options.scenario,
		agentMode: options.agentMode,
		initialActiveToolNames,
		extensionRunnerRef,
		envOverlay: options.env,
		memoryMode: options.memoryMode,
		memoryFile: options.memoryFile,
		memoryCharLimit: options.memoryCharLimit,
		askUserQuestion: options.askUserQuestion,
		enableBackgroundTasks: options.enableBackgroundTasks,
		enableSubagents: options.enableSubagents,
		subagentTypeRegistry:
			options.subagentTypeRegistry ?? (options.enableSubagents ? createDefaultSubagentTypeRegistry() : undefined),
		// Inject createAgentSession so the factory never imports this module (cycle-safe).
		subagentSessionFactory:
			options.subagentSessionFactory ??
			(options.enableSubagents ? createDefaultSubagentSessionFactory(createAgentSession) : undefined),
		subagentMaxConcurrent: options.subagentMaxConcurrent,
		enableMcp: options.enableMcp,
		agentPlugins: options.agentPlugins,
		invokePluginTool: options.invokePluginTool,
		invokePluginContinuation: options.invokePluginContinuation,
		invokePluginSystemPrompt: options.invokePluginSystemPrompt,
	});
	agentSessionRef.current = session;
	const extensionsResult = resourceLoader.getExtensions();

	return {
		session,
		extensionsResult,
		modelFallbackMessage,
	};
}
