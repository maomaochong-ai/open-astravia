import { resolve } from "node:path";
import type {
	CodingAgentRuntimeCompositionOptions as GreenfieldRuntimeCompositionOptions,
	CodingAgentRuntimeSessionOptions as GreenfieldRuntimeSessionOptions,
} from "@vetta/coding-agent/composition";
import { FileConversationRuntimeSessionCatalog } from "@vetta/runtime-storage/conversation";
import {
	type AgentPluginContinuationInvoker,
	type AgentPluginSystemPromptInvoker,
	type AgentPluginToolInvoker,
	CatalogRoutedRuntimeHostSessionBackend,
	type ConversationScenario,
	type GreenfieldRuntimeSession,
	RuntimeHost,
	type RuntimeHostOptions,
	type RuntimeHostSessionAssemblyAssessment,
	type SessionConfig,
} from "../../../../runtime-core/src/index.js";
import { DesktopGreenfieldRuntimeBackendPool } from "./desktop-greenfield-runtime-backend-pool.js";

export type DesktopGreenfieldSessionOptions = Pick<
	GreenfieldRuntimeSessionOptions,
	| "cwd"
	| "model"
	| "thinkingLevel"
	| "agentMode"
	| "executionMode"
	| "env"
	| "enableBackgroundTasks"
	| "includeAgentSkills"
	| "systemPromptAddon"
> &
	Pick<SessionConfig, "agentPlugins" | "askUserQuestion" | "enableAgentPlugins">;

export interface DesktopGreenfieldRuntimeCandidateHostOptions {
	readonly serverUrl?: string;
	readonly userQuestionHandler?: RuntimeHostOptions["userQuestionHandler"];
	readonly invokePluginTool?: AgentPluginToolInvoker;
	readonly invokePluginContinuation?: AgentPluginContinuationInvoker;
	readonly invokePluginSystemPrompt?: AgentPluginSystemPromptInvoker;
}

export interface DesktopGreenfieldSessionCandidate {
	readonly session: GreenfieldRuntimeSession;
	readonly assessment: RuntimeHostSessionAssemblyAssessment;
}

/**
 * Desktop 的非生产 Greenfield 组合。
 *
 * Candidate 已经穿过真实 RuntimeHost 与格式路由门禁；生产 runtime.ts 仍显式
 * 使用 Legacy Backend，不会因本对象存在而切换默认实现。
 */
export class DesktopGreenfieldRuntimeCandidate {
	constructor(
		private readonly runtime: RuntimeHost,
		private readonly backendPool: DesktopGreenfieldRuntimeBackendPool,
		private readonly conversationDir: string,
		private readonly cwd: string,
		private readonly agentDir: string | undefined,
		private readonly scenario: ConversationScenario,
	) {}

	async createSession(options: DesktopGreenfieldSessionOptions = {}): Promise<DesktopGreenfieldSessionCandidate> {
		this.assertWorkspace(options.cwd);
		const result = await this.runtime.createSession(this.toSessionConfig(options));
		return this.readCandidate(result.sessionId);
	}

	async resumeSession(
		sessionPath: string,
		options: DesktopGreenfieldSessionOptions = {},
	): Promise<DesktopGreenfieldSessionCandidate> {
		this.assertWorkspace(options.cwd);
		const result = await this.runtime.createSession({
			...this.toSessionConfig(options),
			sessionPath,
		});
		return this.readCandidate(result.sessionId);
	}

	disposeSession(sessionId: string): Promise<void> {
		return this.runtime.disposeSession(sessionId);
	}

	async dispose(): Promise<void> {
		try {
			await this.runtime.disposeAllSessions();
		} finally {
			await this.backendPool.dispose();
		}
	}

	private toSessionConfig(options: DesktopGreenfieldSessionOptions) {
		return {
			cwd: this.cwd,
			agentDir: this.agentDir,
			sessionDir: this.conversationDir,
			model: options.model,
			thinkingLevel: options.thinkingLevel,
			scenario: this.scenario,
			agentMode: options.agentMode,
			executionMode: options.executionMode,
			appendSystemPrompt: options.systemPromptAddon,
			env: options.env ? { ...options.env } : undefined,
			enableBackgroundTasks: options.enableBackgroundTasks,
			includeAgentSkills: options.includeAgentSkills,
			askUserQuestion: options.askUserQuestion,
			enableAgentPlugins: options.enableAgentPlugins,
			agentPlugins: options.agentPlugins,
		};
	}

	private readCandidate(sessionId: string): DesktopGreenfieldSessionCandidate {
		const session = this.backendPool.readSession(sessionId);
		const assessment = this.backendPool.readAssessment(sessionId);
		if (!session || !assessment) {
			throw new Error(`Greenfield RuntimeHost candidate was not retained: ${sessionId}`);
		}
		return { session, assessment };
	}

	private assertWorkspace(cwd: string | undefined): void {
		if (cwd !== undefined && resolve(cwd) !== resolve(this.cwd)) {
			throw new Error("Greenfield candidate session cwd must match its workspace-scoped composition");
		}
	}
}

export async function createDesktopGreenfieldRuntimeCandidate(
	options: GreenfieldRuntimeCompositionOptions,
	hostOptions: DesktopGreenfieldRuntimeCandidateHostOptions = {},
): Promise<DesktopGreenfieldRuntimeCandidate> {
	const scenario = options.scenario ?? "conversation";
	const enableSubagents = isInteractiveScenario(scenario);
	if (options.enableSubagents !== undefined && options.enableSubagents !== enableSubagents) {
		throw new Error(
			`Desktop Greenfield candidate subagent setting conflicts with RuntimeHost scenario policy: ${scenario}`,
		);
	}
	const backendPool = new DesktopGreenfieldRuntimeBackendPool({
		compositionDefaults: options,
	});
	const cwd = options.cwd ?? process.cwd();
	const catalog = new FileConversationRuntimeSessionCatalog({
		roots: [{ cwd, sessionDir: options.conversationDir }],
		ownershipManager: options.conversationOwnershipManager,
	});
	const routedBackend = new CatalogRoutedRuntimeHostSessionBackend({
		defaultBackend: backendPool,
		routes: [{ catalog, backend: backendPool }],
	});
	const runtime = new RuntimeHost({
		sessionBackend: routedBackend,
		sessionCatalog: catalog,
		serverUrl: hostOptions.serverUrl,
		userQuestionHandler: hostOptions.userQuestionHandler,
	});
	runtime.setPluginToolInvoker(hostOptions.invokePluginTool);
	runtime.setPluginContinuationInvoker(hostOptions.invokePluginContinuation);
	runtime.setPluginSystemPromptInvoker(hostOptions.invokePluginSystemPrompt);
	return new DesktopGreenfieldRuntimeCandidate(
		runtime,
		backendPool,
		options.conversationDir,
		cwd,
		options.agentDir,
		scenario,
	);
}

function isInteractiveScenario(scenario: ConversationScenario): boolean {
	return scenario === "conversation" || scenario === "project" || scenario === "cli";
}
