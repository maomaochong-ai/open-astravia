import type { RuntimeActiveSessionHost, RuntimeHostSession } from "@vetta/runtime-core";
import type { CodingAgentRuntimeSessionOptions } from "../../composition/contracts/index.js";
import type { CodingAgentSdkSessionCapabilityPort, CodingAgentSdkSessionRuntimePort } from "./runtime-contracts.js";

/** RuntimeHost Session view 到稳定 SDK Runtime Port 的绑定。 */
export function bindCodingAgentSdkSessionRuntime(
	session: RuntimeHostSession,
	capabilities: CodingAgentSdkSessionCapabilityPort,
): CodingAgentSdkSessionRuntimePort {
	return {
		capabilities,
		get sessionId() {
			return session.sessionId;
		},
		get sessionPath() {
			return session.sessionPath;
		},
		prompt: (request) => capabilities.prompt(request),
		abort: (reason) => session.abort(reason),
		readState: () => session.readState(),
		readMessages: () => session.readMessages(),
		selectModel: async (modelKey) => {
			const separator = modelKey.indexOf("/");
			if (separator < 0) return;
			await capabilities.selectModel(modelKey.slice(0, separator), modelKey.slice(separator + 1));
		},
		setThinkingLevel: (level) => capabilities.setThinkingLevel(level),
		subscribeExecutionObservation: (handler) => session.subscribeExecutionObservations(handler),
		dispose: () => session.dispose(),
	};
}

/** 活动会话宿主到稳定 SDK Runtime Port 的绑定；所有读取都解析当前 Session。 */
export function bindCodingAgentSdkActiveSessionRuntime(
	host: Pick<
		RuntimeActiveSessionHost<CodingAgentRuntimeSessionOptions, RuntimeHostSession>,
		"readSession" | "startActiveSessionOperation" | "subscribeExecutionObservations"
	>,
	capabilities: CodingAgentSdkSessionCapabilityPort,
	dispose: () => Promise<void>,
): CodingAgentSdkSessionRuntimePort {
	return {
		capabilities,
		get sessionId() {
			return host.readSession().sessionId;
		},
		get sessionPath() {
			return host.readSession().sessionPath;
		},
		prompt: (request) => host.startActiveSessionOperation(() => capabilities.prompt(request)),
		abort: (reason) => host.readSession().abort(reason),
		readState: () => host.readSession().readState(),
		readMessages: () => host.readSession().readMessages(),
		selectModel: async (modelKey) => {
			const separator = modelKey.indexOf("/");
			if (separator < 0) return;
			await capabilities.selectModel(modelKey.slice(0, separator), modelKey.slice(separator + 1));
		},
		setThinkingLevel: (level) => capabilities.setThinkingLevel(level),
		subscribeExecutionObservation: (handler) => host.subscribeExecutionObservations(handler),
		dispose,
	};
}
