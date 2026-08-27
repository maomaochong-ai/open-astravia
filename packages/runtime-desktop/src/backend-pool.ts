import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type { Api, Model } from "@vetta/ai";
import { resolveCodingAgentSessionDir } from "@vetta/coding-agent/bootstrap";
import {
	type CodingAgentRuntimeComposition,
	type CodingAgentRuntimeCompositionOptions,
	createCodingAgentRuntimeComposition,
	createCodingAgentRuntimeSessionAgentSelection,
	DEFAULT_CODING_AGENT_RUNTIME_ID,
} from "@vetta/coding-agent/composition";
import { createCodingAgentNodeSettingsRuntime } from "@vetta/coding-agent/host-services";
import { detectWorkspaceFacts, probeWorkspaceSignals } from "@vetta/coding-agent/model-context";
import type {
	ConversationScenario,
	RuntimeHostSessionAssembly,
	RuntimeHostSessionBackend,
	RuntimeObservationPublisher,
	RuntimeSessionCreateRequest,
} from "@vetta/runtime-core";
import { RetryableCleanup, RetryableCloseController } from "@vetta/runtime-core";
import type { McpRuntimeToolSource } from "@vetta/runtime-mcp";
import { nodeModelInputImageProcessor, nodeWorkspaceFactsFileSource } from "@vetta/runtime-node/coding";
import { createFileConversationPersistence, resolveSessionIdFromPath } from "@vetta/runtime-node/conversation";
import type { CodingToolResultPolicy } from "@vetta/runtime-tools";
import {
	createDesktopCodingAgentSessionExecutionEnvironment,
	createDesktopCodingAgentToolEnvironment,
} from "./coding-agent-tool-environment.js";

type CompositionFixedOption =
	| "agentDir"
	| "createSessionExecutionEnvironment"
	| "createToolEnvironment"
	| "createConversationPersistence"
	| "conversationDir"
	| "cwd"
	| "enableSubagents"
	| "initialModel"
	| "initialThinkingLevel"
	| "scenario"
	| "runtimeHostRetrySettings"
	| "workspaceFacts";

export type DesktopCodingAgentRuntimeCompositionDefaults = Omit<
	CodingAgentRuntimeCompositionOptions,
	CompositionFixedOption
> &
	Partial<
		Pick<
			CodingAgentRuntimeCompositionOptions,
			"createConversationPersistence" | "initialModel" | "initialThinkingLevel"
		>
	>;

export interface DesktopRuntimeBackendPoolOptions {
	readonly compositionDefaults: DesktopCodingAgentRuntimeCompositionDefaults;
	/**
	 * RuntimeHost-scoped publisher used by product observations and retry diagnostics.
	 * When provided, it is the sole upstream and overrides a default observationHub parent while preserving local Hub behavior.
	 */
	readonly observationPublisher?: RuntimeObservationPublisher;
	readonly createHookAdapterFactories?: (
		scope: DesktopRuntimeHookScope,
	) => NonNullable<CodingAgentRuntimeCompositionOptions["additionalHookAdapterFactories"]>;
	readonly createComposition?: (
		options: CodingAgentRuntimeCompositionOptions,
	) => Promise<CodingAgentRuntimeComposition>;
	readonly createMcpRuntimeSource?: (scope: DesktopMcpRuntimeScope) => Promise<DesktopManagedMcpRuntimeSource>;
	readonly resolveMcpRuntimeScope?: (scope: DesktopMcpRuntimeScope) => DesktopMcpRuntimeScope;
	readonly createCodingToolResultPolicy?: (scope: DesktopMcpRuntimeScope) => CodingToolResultPolicy;
}

export interface DesktopRuntimeHookScope {
	readonly cwd: string;
	readonly agentDir?: string;
	readonly scenario: ConversationScenario;
}

export interface DesktopMcpRuntimeScope {
	readonly cwd: string;
	readonly agentDir?: string;
}

export interface DesktopManagedMcpRuntimeSource {
	readonly source: McpRuntimeToolSource;
	dispose(): Promise<void>;
}

interface DesktopRuntimeScope extends DesktopMcpRuntimeScope {
	readonly conversationDir: string;
	readonly scenario: ConversationScenario;
	readonly enableSubagents: boolean;
	readonly serverUrl?: string;
}

interface DesktopRuntimeBackendEntry {
	readonly composition: CodingAgentRuntimeComposition;
}

/**
 * Desktop 进程级 Runtime Backend 池。
 *
 * RuntimeHost 仍然只有一个；本对象只按 Composition 固定参数复用工作区后端，
 * 不持有第二套宿主会话状态。会话级模型、thinking、插件和执行模式继续由
 * RuntimeSessionCreateRequest 传给对应 Session。
 */
export class DesktopRuntimeBackendPool implements RuntimeHostSessionBackend {
	private readonly entries = new Map<string, Promise<DesktopRuntimeBackendEntry>>();
	private readonly resolvedEntries = new Map<string, DesktopRuntimeBackendEntry>();
	private readonly mcpSources = new Map<string, Promise<DesktopManagedMcpRuntimeSource>>();
	private readonly createComposition: (
		options: CodingAgentRuntimeCompositionOptions,
	) => Promise<CodingAgentRuntimeComposition>;
	private readonly cleanup = new RetryableCleanup();
	private readonly closeController: RetryableCloseController;
	private readonly agentId: string;
	private cleanupPrepared = false;
	private disposed = false;

	constructor(private readonly options: DesktopRuntimeBackendPoolOptions) {
		this.createComposition = options.createComposition ?? createCodingAgentRuntimeComposition;
		this.agentId =
			options.compositionDefaults.agentRuntime?.agentId ??
			options.compositionDefaults.agentRuntime?.definition?.id ??
			DEFAULT_CODING_AGENT_RUNTIME_ID;
		this.closeController = new RetryableCloseController({
			cleanup: () => this.cleanup.run("Desktop Runtime backend pool disposal failed"),
			onCompleted: () => {
				this.entries.clear();
				this.resolvedEntries.clear();
				this.mcpSources.clear();
			},
		});
	}

	async createAssembly(request: RuntimeSessionCreateRequest): Promise<RuntimeHostSessionAssembly> {
		if (this.disposed) throw new Error("Desktop Runtime backend pool is disposed");
		if (request.agent && request.agent.id !== this.agentId) {
			throw new Error(
				`Desktop Coding Agent backend pool cannot execute Agent ${request.agent.id}; expected ${this.agentId}`,
			);
		}
		const scope = resolveRuntimeScope(request);
		const entry = await this.getOrCreateEntry(scope, request);
		if (this.disposed) throw new Error("Desktop Runtime backend pool is disposed");
		return entry.composition.runtimeHostBackend.createAssembly(
			toCodingAgentRuntimeSessionRequest(entry.composition, scope, request),
		);
	}

	readScopeCount(): number {
		return this.resolvedEntries.size;
	}

	readMcpScopeCount(): number {
		return this.mcpSources.size;
	}

	async prewarmMcp(scope: DesktopMcpRuntimeScope): Promise<void> {
		if (this.disposed) throw new Error("Desktop Runtime backend pool is disposed");
		await this.getOrCreateMcpRuntimeSource(scope);
	}

	dispose(): Promise<void> {
		if (!this.disposed) {
			this.disposed = true;
			this.prepareCleanup();
		}
		return this.closeController.run();
	}

	private prepareCleanup(): void {
		if (this.cleanupPrepared) return;
		this.cleanupPrepared = true;
		for (const [index, entry] of [...this.entries.values()].entries()) {
			this.cleanup.add({
				id: `composition:${index}`,
				phase: 0,
				cleanup: async () => {
					const resolved = await entry.catch(() => undefined);
					await resolved?.composition.dispose();
				},
			});
		}
		for (const [index, source] of [...this.mcpSources.values()].entries()) {
			this.cleanup.add({
				id: `mcp-source:${index}`,
				phase: 1,
				cleanup: async () => {
					const resolved = await source.catch(() => undefined);
					await resolved?.dispose();
				},
			});
		}
	}

	private getOrCreateEntry(
		scope: DesktopRuntimeScope,
		request: RuntimeSessionCreateRequest,
	): Promise<DesktopRuntimeBackendEntry> {
		const key = runtimeScopeKey(scope);
		const existing = this.entries.get(key);
		if (existing) return existing;

		const created = this.createEntry(scope, request).then(
			(entry) => {
				this.resolvedEntries.set(key, entry);
				return entry;
			},
			(error: unknown) => {
				this.entries.delete(key);
				throw error;
			},
		);
		this.entries.set(key, created);
		return created;
	}

	private async createEntry(
		scope: DesktopRuntimeScope,
		request: RuntimeSessionCreateRequest,
	): Promise<DesktopRuntimeBackendEntry> {
		const initialModel = resolveInitialModel(request, this.options.compositionDefaults);
		const initialThinkingLevel =
			request.thinkingLevel ?? this.options.compositionDefaults.initialThinkingLevel ?? "off";
		const managedMcpSource = await this.getOrCreateMcpRuntimeSource({
			cwd: scope.cwd,
			agentDir: scope.agentDir,
		});
		const observationOptions = resolveCompositionObservationOptions(this.options);
		const composition = await this.createComposition({
			...this.options.compositionDefaults,
			...observationOptions,
			modelInputImageProcessor:
				this.options.compositionDefaults.modelInputImageProcessor ?? nodeModelInputImageProcessor,
			ocrMaxConcurrent:
				this.options.compositionDefaults.ocrMaxConcurrent ??
				resolvePositiveInteger(process.env.VETTA_KB_OCR_CONCURRENCY),
			createConversationPersistence:
				this.options.compositionDefaults.createConversationPersistence ??
				(() => createFileConversationPersistence(scope.conversationDir)),
			createToolEnvironment: createDesktopCodingAgentToolEnvironment,
			createSessionExecutionEnvironment: createDesktopCodingAgentSessionExecutionEnvironment,
			codingToolResultPolicy:
				this.options.createCodingToolResultPolicy?.({
					cwd: scope.cwd,
					agentDir: scope.agentDir,
				}) ?? this.options.compositionDefaults.codingToolResultPolicy,
			additionalHookAdapterFactories: [
				...(this.options.compositionDefaults.additionalHookAdapterFactories ?? []),
				...(this.options.createHookAdapterFactories?.(scope) ?? []),
			],
			...(managedMcpSource ? { mcpSource: managedMcpSource.source } : {}),
			conversationDir: scope.conversationDir,
			cwd: scope.cwd,
			workspaceFacts: detectWorkspaceFacts(scope.cwd, (cwd) =>
				probeWorkspaceSignals(cwd, nodeWorkspaceFactsFileSource),
			),
			agentDir: scope.agentDir,
			scenario: scope.scenario,
			enableSubagents: scope.enableSubagents,
			createSubagentId: randomUUID,
			subagentPathPort: { dirname, join },
			initialModel,
			initialThinkingLevel,
			runtimeHostRetrySettings: createCodingAgentNodeSettingsRuntime(scope.cwd, scope.agentDir),
		});
		return { composition };
	}

	private getOrCreateMcpRuntimeSource(
		scope: DesktopMcpRuntimeScope,
	): Promise<DesktopManagedMcpRuntimeSource> | undefined {
		if (!this.options.createMcpRuntimeSource) return undefined;
		const resolvedScope = this.options.resolveMcpRuntimeScope?.(scope) ?? scope;
		const normalizedScope = {
			cwd: resolve(resolvedScope.cwd),
			agentDir: resolvedScope.agentDir ? resolve(resolvedScope.agentDir) : undefined,
		};
		const key = mcpRuntimeScopeKey(normalizedScope);
		const existing = this.mcpSources.get(key);
		if (existing) return existing;

		const created = this.options.createMcpRuntimeSource(normalizedScope).catch((error: unknown) => {
			this.mcpSources.delete(key);
			throw error;
		});
		this.mcpSources.set(key, created);
		return created;
	}
}

function toCodingAgentRuntimeSessionRequest(
	composition: CodingAgentRuntimeComposition,
	scope: DesktopRuntimeScope,
	request: RuntimeSessionCreateRequest,
): RuntimeSessionCreateRequest {
	const sessionPath = request.sessionPath?.trim();
	const sessionId = sessionPath
		? resolveSessionIdFromPath(scope.conversationDir, sessionPath)
		: request.sessionId?.trim() || randomUUID();
	if (!sessionId) {
		throw new Error(`Session path is invalid: ${request.sessionPath}`);
	}
	const sessionOptions = {
		sessionId,
		cwd: request.cwd ?? scope.cwd,
		model: request.model,
		thinkingLevel: request.thinkingLevel,
		agentMode: request.agentMode,
		executionMode: request.executionMode,
		env: request.env,
		enableBackgroundTasks: request.enableBackgroundTasks,
		includeAgentSkills: request.includeAgentSkills,
		askUserQuestion: request.askUserQuestion,
		sandboxHostPath: request.sandboxHostPath,
		linuxBubblewrapPath: request.linuxBubblewrapPath,
		macosSandboxExecPath: request.macosSandboxExecPath,
		systemPromptAddon: request.appendSystemPrompt,
	};
	return {
		...request,
		agent: createCodingAgentRuntimeSessionAgentSelection(composition.agentRuntime, sessionOptions),
	};
}

function resolveCompositionObservationOptions(
	options: DesktopRuntimeBackendPoolOptions,
): Pick<CodingAgentRuntimeCompositionOptions, "observationHub" | "observationPublisher"> {
	const observationPublisher = options.observationPublisher ?? options.compositionDefaults.observationPublisher;
	const observationHub = options.compositionDefaults.observationHub;
	if (!options.observationPublisher || !observationHub?.parent) {
		return {
			...(observationPublisher ? { observationPublisher } : {}),
			...(observationHub ? { observationHub } : {}),
		};
	}
	const { parent: _overriddenParent, ...localHubOptions } = observationHub;
	return { observationPublisher: options.observationPublisher, observationHub: localHubOptions };
}

function resolveRuntimeScope(request: RuntimeSessionCreateRequest): DesktopRuntimeScope {
	const cwd = resolve(request.cwd ?? process.cwd());
	const sessionPath = request.sessionPath?.trim();
	// 缺省落点是 agent 目录下按 cwd 编码分片的全局目录，**不是** `<cwd>/.vetta/sessions`：
	// 会话产物是宿主状态，不该在用户工程里长出未跟踪文件（还会被 `git add -A` 误提交）。
	// 需要落在项目里的场景（批量任务、宿主自有 conversation 根）自己传 sessionDir。
	const conversationDir = resolve(
		sessionPath ? dirname(sessionPath) : resolveCodingAgentSessionDir(cwd, request.sessionDir),
	);
	return {
		cwd,
		conversationDir,
		agentDir: request.agentDir ? resolve(request.agentDir) : undefined,
		scenario: request.scenario ?? "cli",
		enableSubagents: request.enableSubagents,
		serverUrl: request.serverUrl,
	};
}

function resolveInitialModel(
	request: RuntimeSessionCreateRequest,
	defaults: DesktopCodingAgentRuntimeCompositionDefaults,
): Model<Api> {
	const model = request.model ?? defaults.initialModel ?? defaults.modelRegistry.getAvailable()[0];
	if (!model) {
		throw new Error("Desktop Runtime requires at least one available model");
	}
	return model;
}

function resolvePositiveInteger(value: string | undefined): number | undefined {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

function runtimeScopeKey(scope: DesktopRuntimeScope): string {
	return JSON.stringify([
		scope.cwd,
		scope.conversationDir,
		scope.agentDir ?? null,
		scope.scenario,
		scope.enableSubagents,
		scope.serverUrl ?? null,
	]);
}

function mcpRuntimeScopeKey(scope: DesktopMcpRuntimeScope): string {
	return JSON.stringify([scope.cwd, scope.agentDir ?? null]);
}
