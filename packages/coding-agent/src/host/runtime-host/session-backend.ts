import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
	assessRuntimeHostSessionAssembly,
	type ConversationScenario,
	type RuntimeHostSessionAssembly,
	type RuntimeHostSessionBackend,
	type RuntimeSession,
	type RuntimeSessionCreateRequest,
	runtimeError,
} from "@vetta/runtime-core";
import { resolveSessionIdFromPath } from "@vetta/runtime-node/conversation";
import { CONVERSATION_STORAGE_ERROR_CODES, ConversationStorageError } from "@vetta/runtime-storage";
import type {
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeSessionOptions,
} from "../../composition/runtime-composition.js";
import { createCodingAgentNodeSettingsRuntime } from "../node-state-services.js";
import { type CodingAgentRuntimeHostRetrySettings, withCodingAgentRuntimeHostRetry } from "./session-retry.js";

export interface CodingAgentSessionBackendOptions {
	readonly composition: CodingAgentRuntimeComposition;
	readonly conversationDir: string;
	readonly cwd: string;
	readonly agentDir?: string;
	readonly scenario: ConversationScenario;
	readonly enableSubagents: boolean;
	readonly serverUrl?: string;
	readonly retrySettings?: CodingAgentRuntimeHostRetrySettings;
}

/**
 * 将 RuntimeHost 的实现无关请求适配到 Coding Agent Backend。
 *
 * 组合根固定的参数必须相等；尚未接线的宿主能力必须显式失败，禁止静默丢失。
 */
export class CodingAgentSessionBackend implements RuntimeHostSessionBackend {
	private readonly retrySettings: CodingAgentRuntimeHostRetrySettings;

	constructor(private readonly options: CodingAgentSessionBackendOptions) {
		this.retrySettings = options.retrySettings ?? createCodingAgentNodeSettingsRuntime(options.cwd, options.agentDir);
	}

	async createAssembly(request: RuntimeSessionCreateRequest): Promise<RuntimeHostSessionAssembly> {
		this.assertSupportedRequest(request);
		const sessionPath = request.sessionPath?.trim();
		const sessionOptions = this.toSessionOptions(request);
		let session: RuntimeSession;
		try {
			session = sessionPath
				? await this.options.composition.sessions.resume(sessionOptions)
				: await this.options.composition.sessions.create(sessionOptions);
		} catch (error) {
			throw mapRuntimeHostSessionCreationError(error);
		}
		const assessment = assessRuntimeHostSessionAssembly(session.createRuntimeHostAssemblyCandidate());
		if (!assessment.ready) {
			await session.dispose();
			throw new Error(`RuntimeHost assembly is incomplete: ${assessment.missingPorts.join(", ")}`);
		}

		return withCodingAgentRuntimeHostRetry(session, assessment.assembly, this.retrySettings);
	}

	private toSessionOptions(request: RuntimeSessionCreateRequest): CodingAgentRuntimeSessionOptions {
		const sessionPath = request.sessionPath?.trim();
		const sessionId = sessionPath
			? resolveSessionIdFromPath(this.options.conversationDir, sessionPath)
			: randomUUID();
		if (!sessionId) {
			throw new Error(`Session path is invalid: ${request.sessionPath}`);
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
			pluginTurnHandlerLeaseProvider: request.pluginTurnHandlerLeaseProvider,
			askUserQuestion: request.askUserQuestion,
			sandboxHostPath: request.sandboxHostPath,
			linuxBubblewrapPath: request.linuxBubblewrapPath,
			macosSandboxExecPath: request.macosSandboxExecPath,
			systemPromptAddon: request.appendSystemPrompt,
		};
	}

	private assertSupportedRequest(request: RuntimeSessionCreateRequest): void {
		if (request.agent && request.agent.id !== this.options.composition.agentRuntime.agentId) {
			throw new Error(
				`Coding Agent Session Backend cannot execute Agent ${request.agent.id}; expected ${this.options.composition.agentRuntime.agentId}`,
			);
		}
		assertSamePath("cwd", request.cwd, this.options.cwd);
		assertSamePath("sessionDir", request.sessionDir, this.options.conversationDir);
		assertSamePath("agentDir", request.agentDir, this.options.agentDir);
		if (request.scenario !== undefined && request.scenario !== this.options.scenario) {
			throw new Error(
				`RuntimeHost scenario mismatch: expected ${this.options.scenario}, received ${request.scenario}`,
			);
		}
		if (request.enableSubagents !== this.options.enableSubagents) {
			throw new Error(
				`RuntimeHost subagent mismatch: expected ${this.options.enableSubagents}, received ${request.enableSubagents}`,
			);
		}
		if (request.serverUrl !== undefined && request.serverUrl !== this.options.serverUrl) {
			throw new Error("RuntimeHost serverUrl is not supported by this composition");
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
	throw new Error(`RuntimeHost ${name} mismatch: expected ${configured ?? "<unset>"}, received ${requested}`);
}
