import type { SessionConfig, SessionExecutionMode } from "../contracts.js";
import type { RuntimeSessionCreateRequest } from "./session-backend.js";

const DEFAULT_RUNTIME_SCENARIO: NonNullable<SessionConfig["scenario"]> = "cli";

export interface RuntimeHostSessionRequestFactoryOptions {
	readonly serverUrl?: string;
	readonly sandboxHostPath?: string;
	readonly linuxBubblewrapPath?: string;
	readonly macosSandboxExecPath?: string;
}

/**
 * Compatibility projection from the public SessionConfig to the backend-neutral request.
 * Product/platform fields remain quarantined here until their public contract migration.
 */
export class RuntimeHostSessionRequestFactory {
	constructor(private readonly options: RuntimeHostSessionRequestFactoryOptions) {}

	create(
		config: SessionConfig,
		executionMode: SessionExecutionMode,
		sessionIdRef: { current?: string },
	): RuntimeSessionCreateRequest {
		return {
			agent: config.agent,
			sessionId: config.sessionId,
			cwd: config.cwd,
			agentDir: config.agentDir,
			sessionPath: config.sessionPath?.trim() || undefined,
			sessionDir: config.sessionDir,
			model: config.model,
			thinkingLevel: config.thinkingLevel,
			scenario: config.scenario,
			agentMode: config.agentMode,
			executionMode,
			appendSystemPrompt: config.appendSystemPrompt,
			env: config.env,
			enableBackgroundTasks: config.enableBackgroundTasks,
			enableSubagents: shouldEnableSubagents(config.scenario),
			includeAgentSkills: config.includeAgentSkills,
			serverUrl: this.options.serverUrl,
			sandboxHostPath: this.options.sandboxHostPath,
			linuxBubblewrapPath: this.options.linuxBubblewrapPath,
			macosSandboxExecPath: this.options.macosSandboxExecPath,
			getSessionId: () => sessionIdRef.current,
		};
	}
}

/** Compatibility gate retained from the original RuntimeHost contract. */
function shouldEnableSubagents(scenario: SessionConfig["scenario"]): boolean {
	const resolvedScenario = scenario ?? DEFAULT_RUNTIME_SCENARIO;
	return resolvedScenario === "conversation" || resolvedScenario === "project" || resolvedScenario === "cli";
}
