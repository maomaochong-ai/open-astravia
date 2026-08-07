import type {
	CodingAgentExtensionRunnerPort,
	CodingAgentExtensionToolSource,
	CodingAgentSessionToolRegistration,
} from "../../runtime-contracts/index.js";
import type { CodingAgentRuntimeExtensionControls } from "../contracts/index.js";
import type { CodingAgentSessionResourceIndexes } from "./resource-lifecycle.js";

export interface CodingAgentExtensionToolHostPort {
	bindRunner(
		sessionId: string,
		runner: CodingAgentExtensionRunnerPort,
		options?: { readonly replaceExisting?: boolean },
	): () => void;
	refresh(extensions: readonly CodingAgentExtensionToolSource[]): void;
	replaceSessionTools(sessionId: string, tools: readonly CodingAgentSessionToolRegistration[]): void;
	clearSessionTools(sessionId: string): void;
}

export interface CodingAgentRuntimeExtensionControlsOptions {
	readonly indexes: Pick<CodingAgentSessionResourceIndexes, "extensionEventBridges">;
	readonly extensionToolRuntime?: CodingAgentExtensionToolHostPort;
}

/** 将宿主 Extension 调用投影到 Session Event Bridge 与进程级 Tool Runtime。 */
export function createCodingAgentRuntimeExtensionControls(
	options: CodingAgentRuntimeExtensionControlsOptions,
): CodingAgentRuntimeExtensionControls {
	return {
		bindExtensionRunner(sessionId, runner, bindingOptions) {
			const bridge = options.indexes.extensionEventBridges.get(sessionId);
			if (!bridge) throw new Error(`Extension run adapter not found: ${sessionId}`);
			const unbindEvents = bridge.bind(runner, bindingOptions);
			const unbindTools = options.extensionToolRuntime?.bindRunner(sessionId, runner, bindingOptions);
			return {
				readSystemPrompt: () => bridge.readSystemPrompt(),
				dispose() {
					unbindTools?.();
					unbindEvents();
				},
			};
		},
		refreshExtensionTools(extensions) {
			options.extensionToolRuntime?.refresh(extensions);
		},
		replaceSessionTools(sessionId, tools) {
			if (!options.extensionToolRuntime) throw new Error("Session tool runtime is unavailable");
			options.extensionToolRuntime.replaceSessionTools(sessionId, tools);
		},
		clearSessionTools(sessionId) {
			options.extensionToolRuntime?.clearSessionTools(sessionId);
		},
	};
}
