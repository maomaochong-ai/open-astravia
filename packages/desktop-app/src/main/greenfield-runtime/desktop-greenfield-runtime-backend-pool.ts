import { dirname, join, resolve } from "node:path";
import type { Api, Model } from "@vetta/ai";
import {
	type CodingAgentRuntimeComposition,
	type CodingAgentRuntimeCompositionOptions,
	createCodingAgentRuntimeComposition,
	CodingAgentRuntimeHostSessionBackend as GreenfieldRuntimeHostSessionBackend,
} from "@vetta/coding-agent/composition";
import type {
	ConversationScenario,
	GreenfieldRuntimeSession,
	RuntimeHostSessionAssembly,
	RuntimeHostSessionAssemblyAssessment,
	RuntimeHostSessionBackend,
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

export interface DesktopGreenfieldRuntimeBackendPoolOptions {
	readonly compositionDefaults: DesktopCodingAgentRuntimeCompositionDefaults;
	readonly createComposition?: (
		options: CodingAgentRuntimeCompositionOptions,
	) => Promise<CodingAgentRuntimeComposition>;
	readonly createMcpRuntimeSource?: (
		scope: DesktopGreenfieldMcpRuntimeScope,
	) => Promise<DesktopGreenfieldManagedMcpRuntimeSource>;
}

export interface DesktopGreenfieldMcpRuntimeScope {
	readonly cwd: string;
	readonly agentDir?: string;
}

export interface DesktopGreenfieldManagedMcpRuntimeSource {
	readonly source: McpRuntimeToolSource;
	dispose(): Promise<void>;
}

interface DesktopGreenfieldRuntimeScope extends DesktopGreenfieldMcpRuntimeScope {
	readonly conversationDir: string;
	readonly scenario: ConversationScenario;
	readonly enableSubagents: boolean;
	readonly serverUrl?: string;
}

interface DesktopGreenfieldRuntimeBackendEntry {
	readonly composition: CodingAgentRuntimeComposition;
	readonly backend: GreenfieldRuntimeHostSessionBackend;
	readonly managedMcpSource?: DesktopGreenfieldManagedMcpRuntimeSource;
}

/**
 * Desktop 进程级 Greenfield Backend 池。
 *
 * RuntimeHost 仍然只有一个；本对象只按 Composition 固定参数复用工作区后端，
 * 不持有第二套宿主会话状态。会话级模型、thinking、插件和执行模式继续由
 * RuntimeSessionCreateRequest 传给对应 Session。
 */
export class DesktopGreenfieldRuntimeBackendPool implements RuntimeHostSessionBackend {
	private readonly entries = new Map<string, Promise<DesktopGreenfieldRuntimeBackendEntry>>();
	private readonly resolvedEntries = new Map<string, DesktopGreenfieldRuntimeBackendEntry>();
	private readonly createComposition: (
		options: CodingAgentRuntimeCompositionOptions,
	) => Promise<CodingAgentRuntimeComposition>;
	private disposed = false;

	constructor(private readonly options: DesktopGreenfieldRuntimeBackendPoolOptions) {
		this.createComposition = options.createComposition ?? createCodingAgentRuntimeComposition;
	}

	async createAssembly(request: RuntimeSessionCreateRequest): Promise<RuntimeHostSessionAssembly> {
		if (this.disposed) throw new Error("Desktop Greenfield Runtime backend pool is disposed");
		const scope = resolveRuntimeScope(request);
		const entry = await this.getOrCreateEntry(scope, request);
		if (this.disposed) throw new Error("Desktop Greenfield Runtime backend pool is disposed");
		return entry.backend.createAssembly(request);
	}

	readSession(sessionId: string): GreenfieldRuntimeSession | undefined {
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

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		const pendingEntries = [...this.entries.values()];
		try {
			const entryResults = await Promise.allSettled(pendingEntries);
			const entries = entryResults.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
			const disposeResults = await Promise.allSettled(entries.map(disposeEntry));
			const errors = [...entryResults, ...disposeResults].flatMap((result) =>
				result.status === "rejected" ? [result.reason] : [],
			);
			if (errors.length > 0) {
				throw new AggregateError(errors, "Desktop Greenfield Runtime backend pool disposal failed");
			}
		} finally {
			this.entries.clear();
			this.resolvedEntries.clear();
		}
	}

	private getOrCreateEntry(
		scope: DesktopGreenfieldRuntimeScope,
		request: RuntimeSessionCreateRequest,
	): Promise<DesktopGreenfieldRuntimeBackendEntry> {
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
		scope: DesktopGreenfieldRuntimeScope,
		request: RuntimeSessionCreateRequest,
	): Promise<DesktopGreenfieldRuntimeBackendEntry> {
		const initialModel = resolveInitialModel(request, this.options.compositionDefaults);
		const initialThinkingLevel =
			request.thinkingLevel ?? this.options.compositionDefaults.initialThinkingLevel ?? "off";
		const managedMcpSource = await this.options.createMcpRuntimeSource?.({
			cwd: scope.cwd,
			agentDir: scope.agentDir,
		});
		let composition: CodingAgentRuntimeComposition;
		try {
			composition = await this.createComposition({
				...this.options.compositionDefaults,
				...(managedMcpSource ? { mcpSource: managedMcpSource.source } : {}),
				conversationDir: scope.conversationDir,
				cwd: scope.cwd,
				agentDir: scope.agentDir,
				scenario: scope.scenario,
				enableSubagents: scope.enableSubagents,
				initialModel,
				initialThinkingLevel,
			});
		} catch (error) {
			await managedMcpSource?.dispose();
			throw error;
		}
		return {
			composition,
			managedMcpSource,
			backend: new GreenfieldRuntimeHostSessionBackend({
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
}

function resolveRuntimeScope(request: RuntimeSessionCreateRequest): DesktopGreenfieldRuntimeScope {
	const cwd = resolve(request.cwd ?? process.cwd());
	const sessionPath = request.sessionPath?.trim();
	const conversationDir = resolve(
		sessionPath ? dirname(sessionPath) : (request.sessionDir ?? join(cwd, ".vetta", "sessions")),
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
		throw new Error("Desktop Greenfield Runtime requires at least one available model");
	}
	return model;
}

function runtimeScopeKey(scope: DesktopGreenfieldRuntimeScope): string {
	return JSON.stringify([
		scope.cwd,
		scope.conversationDir,
		scope.agentDir ?? null,
		scope.scenario,
		scope.enableSubagents,
		scope.serverUrl ?? null,
	]);
}

async function disposeEntry(entry: DesktopGreenfieldRuntimeBackendEntry): Promise<void> {
	const errors: unknown[] = [];
	try {
		await entry.composition.dispose();
	} catch (error) {
		errors.push(error);
	}
	try {
		await entry.managedMcpSource?.dispose();
	} catch (error) {
		errors.push(error);
	}
	if (errors.length > 0) {
		throw new AggregateError(errors, "Desktop Greenfield Runtime scope disposal failed");
	}
}
