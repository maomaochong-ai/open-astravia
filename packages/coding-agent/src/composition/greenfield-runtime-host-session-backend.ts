import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
	assessRuntimeHostSessionAssembly,
	type ConversationScenario,
	type GreenfieldRuntimeSession,
	type RuntimeHostSessionAssembly,
	type RuntimeHostSessionAssemblyAssessment,
	type RuntimeHostSessionBackend,
	type RuntimeSessionCreateRequest,
	runtimeError,
} from "@vetta/runtime-core";
import { CONVERSATION_STORAGE_ERROR_CODES, ConversationStorageError } from "@vetta/runtime-storage";
import { SettingsRuntime } from "../settings/index.js";
import { resolveGreenfieldSessionIdFromPath } from "./greenfield-conversation-path.js";
import {
	type GreenfieldRuntimeHostRetrySettings,
	withGreenfieldRuntimeHostRetry,
} from "./greenfield-runtime-host-retry.js";
import type { CodingAgentRuntimeComposition, CodingAgentRuntimeSessionOptions } from "./runtime-composition.js";

export interface GreenfieldRuntimeHostSessionBackendOptions {
	readonly composition: CodingAgentRuntimeComposition;
	readonly conversationDir: string;
	readonly cwd: string;
	readonly agentDir?: string;
	readonly scenario: ConversationScenario;
	readonly enableSubagents: boolean;
	readonly serverUrl?: string;
	readonly retrySettings?: GreenfieldRuntimeHostRetrySettings;
}

/**
 * 将 RuntimeHost 的实现无关请求适配到 Coding Agent Greenfield Backend。
 *
 * 组合根固定的参数必须相等；尚未接线的宿主能力必须显式失败，禁止静默丢失。
 */
export class GreenfieldRuntimeHostSessionBackend implements RuntimeHostSessionBackend {
	private readonly sessions = new Map<string, GreenfieldRuntimeSession>();
	private readonly assessments = new Map<string, RuntimeHostSessionAssemblyAssessment>();
	private readonly retrySettings: GreenfieldRuntimeHostRetrySettings;

	constructor(private readonly options: GreenfieldRuntimeHostSessionBackendOptions) {
		this.retrySettings = options.retrySettings ?? SettingsRuntime.create(options.cwd, options.agentDir);
	}

	async createAssembly(request: RuntimeSessionCreateRequest): Promise<RuntimeHostSessionAssembly> {
		this.assertSupportedRequest(request);
		const sessionPath = request.sessionPath?.trim();
		const sessionOptions = this.toSessionOptions(request);
		let session: GreenfieldRuntimeSession;
		try {
			session = sessionPath
				? await this.options.composition.backend.resume(sessionOptions)
				: await this.options.composition.backend.create(sessionOptions);
		} catch (error) {
			throw mapRuntimeHostSessionCreationError(error);
		}
		const assessment = assessRuntimeHostSessionAssembly(session.createRuntimeHostAssemblyCandidate());
		if (!assessment.ready) {
			await session.dispose();
			throw new Error(`Greenfield RuntimeHost assembly is incomplete: ${assessment.missingPorts.join(", ")}`);
		}

		const sessionId = session.sessionId;
		this.sessions.set(sessionId, session);
		this.assessments.set(sessionId, assessment);
		const retryAssembly = withGreenfieldRuntimeHostRetry(session, assessment.assembly, this.retrySettings);
		const lifecycle = retryAssembly.lifecycle;
		return {
			...retryAssembly,
			lifecycle: {
				...lifecycle,
				dispose: async () => {
					try {
						await lifecycle.dispose();
					} finally {
						this.sessions.delete(sessionId);
						this.assessments.delete(sessionId);
					}
				},
			},
		};
	}

	readSession(sessionId: string): GreenfieldRuntimeSession | undefined {
		return this.sessions.get(sessionId);
	}

	readAssessment(sessionId: string): RuntimeHostSessionAssemblyAssessment | undefined {
		return this.assessments.get(sessionId);
	}

	private toSessionOptions(request: RuntimeSessionCreateRequest): CodingAgentRuntimeSessionOptions {
		const sessionPath = request.sessionPath?.trim();
		const sessionId = sessionPath
			? resolveGreenfieldSessionIdFromPath(this.options.conversationDir, sessionPath)
			: randomUUID();
		if (!sessionId) {
			throw new Error(`Greenfield session path is invalid: ${request.sessionPath}`);
		}
		return {
			sessionId,
			cwd: request.cwd ?? this.options.cwd,
			model: request.model,
			thinkingLevel: request.thinkingLevel,
			agentMode: request.agentMode,
			executionMode: request.executionMode,
			env: request.env,
			enableBackgroundTasks: request.enableBackgroundTasks,
			includeAgentSkills: request.includeAgentSkills,
			agentPlugins: request.agentPlugins,
			invokePluginTool: request.invokePluginTool,
			invokePluginContinuation: request.invokePluginContinuation,
			invokePluginSystemPrompt: request.invokePluginSystemPrompt,
			askUserQuestion: request.askUserQuestion,
			sandboxHostPath: request.sandboxHostPath,
			linuxBubblewrapPath: request.linuxBubblewrapPath,
			macosSandboxExecPath: request.macosSandboxExecPath,
			systemPromptAddon: request.appendSystemPrompt,
		};
	}

	private assertSupportedRequest(request: RuntimeSessionCreateRequest): void {
		assertSamePath("cwd", request.cwd, this.options.cwd);
		assertSamePath("sessionDir", request.sessionDir, this.options.conversationDir);
		assertSamePath("agentDir", request.agentDir, this.options.agentDir);
		if (request.scenario !== undefined && request.scenario !== this.options.scenario) {
			throw new Error(
				`Greenfield RuntimeHost scenario mismatch: expected ${this.options.scenario}, received ${request.scenario}`,
			);
		}
		if (request.enableSubagents !== this.options.enableSubagents) {
			throw new Error(
				`Greenfield RuntimeHost subagent mismatch: expected ${this.options.enableSubagents}, received ${request.enableSubagents}`,
			);
		}
		if (request.serverUrl !== undefined && request.serverUrl !== this.options.serverUrl) {
			throw new Error("Greenfield RuntimeHost serverUrl is not supported by this composition");
		}
	}
}

export function mapRuntimeHostSessionCreationError(error: unknown): unknown {
	if (
		error instanceof ConversationStorageError &&
		error.code === CONVERSATION_STORAGE_ERROR_CODES.OWNERSHIP_CONFLICT
	) {
		return runtimeError("SESSION_LOCKED", error.message, false, "runtime");
	}
	return error;
}

function assertSamePath(name: string, requested: string | undefined, configured: string | undefined): void {
	if (requested === undefined) return;
	if (configured !== undefined && resolve(requested) === resolve(configured)) return;
	throw new Error(
		`Greenfield RuntimeHost ${name} mismatch: expected ${configured ?? "<unset>"}, received ${requested}`,
	);
}
