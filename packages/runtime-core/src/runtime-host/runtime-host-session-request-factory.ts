import type { SessionConfig, SessionExecutionMode } from "../contracts.js";
import type { RuntimeSessionCreateRequest } from "./session-backend.js";

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
			executionMode,
			env: config.env,
			serverUrl: this.options.serverUrl,
			sandboxHostPath: this.options.sandboxHostPath,
			linuxBubblewrapPath: this.options.linuxBubblewrapPath,
			macosSandboxExecPath: this.options.macosSandboxExecPath,
			getSessionId: () => sessionIdRef.current,
		};
	}
}
