import { dirname, resolve } from "node:path";
import type { Api, Model } from "@vetta/ai";
import { resolveCodingAgentSessionDir } from "@vetta/coding-agent/bootstrap";
import {
	type CodingAgentRuntimeComposition,
	type CodingAgentRuntimeCompositionOptions,
	CodingAgentRuntimeHostSessionBackend,
	createCodingAgentRuntimeComposition,
} from "@vetta/coding-agent/composition";
import type {
	ConversationScenario,
	RuntimeHostSessionAssembly,
	RuntimeHostSessionAssemblyAssessment,
	RuntimeHostSessionBackend,
	RuntimeSession,
	RuntimeSessionCreateRequest,
} from "@vetta/runtime-core";
import type { McpRuntimeToolSource } from "@vetta/runtime-mcp";

type CompositionFixedOption =
	| "agentDir"
	| "conversationDir"
	| "cwd"
	| "enableSubagents"
	| "initialModel"
	| "initialThinkingLevel"
	| "scenario";

export type DesktopCodingAgentRuntimeCompositionDefaults = Omit<
	CodingAgentRuntimeCompositionOptions,
	CompositionFixedOption
> &
	Partial<Pick<CodingAgentRuntimeCompositionOptions, "initialModel" | "initialThinkingLevel">>;

export interface DesktopRuntimeBackendPoolOptions {
	readonly compositionDefaults: DesktopCodingAgentRuntimeCompositionDefaults;
	readonly createHookAdapterFactories?: (
		scope: DesktopRuntimeHookScope,
	) => NonNullable<CodingAgentRuntimeCompositionOptions["additionalHookAdapterFactories"]>;
	readonly createComposition?: (
		options: CodingAgentRuntimeCompositionOptions,
	) => Promise<CodingAgentRuntimeComposition>;
	readonly createMcpRuntimeSource?: (scope: DesktopMcpRuntimeScope) => Promise<DesktopManagedMcpRuntimeSource>;
	readonly resolveMcpRuntimeScope?: (scope: DesktopMcpRuntimeScope) => DesktopMcpRuntimeScope;
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
	readonly backend: CodingAgentRuntimeHostSessionBackend;
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
	private disposed = false;

	constructor(private readonly options: DesktopRuntimeBackendPoolOptions) {
		this.createComposition = options.createComposition ?? createCodingAgentRuntimeComposition;
	}

	async createAssembly(request: RuntimeSessionCreateRequest): Promise<RuntimeHostSessionAssembly> {
		if (this.disposed) throw new Error("Desktop Runtime backend pool is disposed");
		const scope = resolveRuntimeScope(request);
		const entry = await this.getOrCreateEntry(scope, request);
		if (this.disposed) throw new Error("Desktop Runtime backend pool is disposed");
		return entry.backend.createAssembly(request);
	}

	readSession(sessionId: string): RuntimeSession | undefined {
		for (const entry of this.resolvedEntries.values()) {
			const session = entry.backend.readSession(sessionId);
			if (session) return session;
		}
		return undefined;
	}

	readAssessment(sessionId: string): RuntimeHostSessionAssemblyAssessment | undefined {
		for (const entry of this.resolvedEntries.values()) {
			const assessment = entry.backend.readAssessment(sessionId);
			if (assessment) return assessment;
		}
		return undefined;
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

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		const pendingEntries = [...this.entries.values()];
		const pendingMcpSources = [...this.mcpSources.values()];
		try {
			const entryResults = await Promise.allSettled(pendingEntries);
			const entries = entryResults.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
			const disposeResults = await Promise.allSettled(entries.map(disposeEntry));
			const mcpSourceResults = await Promise.allSettled(pendingMcpSources);
			const mcpSources = mcpSourceResults.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
			const mcpDisposeResults = await Promise.allSettled(mcpSources.map((source) => source.dispose()));
			const errors = [...entryResults, ...disposeResults, ...mcpSourceResults, ...mcpDisposeResults].flatMap(
				(result) => (result.status === "rejected" ? [result.reason] : []),
			);
			if (errors.length > 0) {
				throw new AggregateError(errors, "Desktop Runtime backend pool disposal failed");
			}
		} finally {
			this.entries.clear();
			this.resolvedEntries.clear();
			this.mcpSources.clear();
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
		const composition = await this.createComposition({
			...this.options.compositionDefaults,
			additionalHookAdapterFactories: [
				...(this.options.compositionDefaults.additionalHookAdapterFactories ?? []),
				...(this.options.createHookAdapterFactories?.(scope) ?? []),
			],
			...(managedMcpSource ? { mcpSource: managedMcpSource.source } : {}),
			conversationDir: scope.conversationDir,
			cwd: scope.cwd,
			agentDir: scope.agentDir,
			scenario: scope.scenario,
			enableSubagents: scope.enableSubagents,
			initialModel,
			initialThinkingLevel,
		});
		return {
			composition,
			backend: new CodingAgentRuntimeHostSessionBackend({
				composition,
				conversationDir: scope.conversationDir,
				cwd: scope.cwd,
				agentDir: scope.agentDir,
				scenario: scope.scenario,
				enableSubagents: scope.enableSubagents,
				serverUrl: scope.serverUrl,
			}),
		};
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

async function disposeEntry(entry: DesktopRuntimeBackendEntry): Promise<void> {
	await entry.composition.dispose();
}
