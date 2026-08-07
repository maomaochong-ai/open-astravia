import type { GreenfieldRuntimeSession } from "@vetta/runtime-core";
import type { CodingAgentActiveSessionHost } from "../../composition/session-host/active-session-transition-host.js";
import type { GreenfieldSdkSessionCapabilityPort, GreenfieldSdkSessionRuntimePort } from "./runtime-contracts.js";

/** 唯一允许感知 GreenfieldRuntimeSession 具体表面的 SDK 组合边界。 */
export function bindGreenfieldSdkSessionRuntime(
	session: GreenfieldRuntimeSession,
	capabilities: GreenfieldSdkSessionCapabilityPort,
): GreenfieldSdkSessionRuntimePort {
	const assembly = session.createCoreAssembly();
	return {
		capabilities,
		get sessionId() {
			return assembly.lifecycle.sessionId;
		},
		get sessionPath() {
			return assembly.lifecycle.sessionPath;
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
		subscribeExecutionObservation: (handler) => assembly.executionObservationStream.subscribe(handler),
		dispose: () => session.dispose(),
	};
}

/** 活动会话宿主到稳定 SDK Runtime Port 的绑定；所有读取都解析当前 Session。 */
export function bindGreenfieldSdkActiveSessionRuntime(
	host: Pick<
		CodingAgentActiveSessionHost,
		"readSession" | "startActiveSessionOperation" | "subscribeExecutionObservations"
	>,
	capabilities: GreenfieldSdkSessionCapabilityPort,
	dispose: () => Promise<void>,
): GreenfieldSdkSessionRuntimePort {
	const readAssembly = () => host.readSession().createCoreAssembly();
	return {
		capabilities,
		get sessionId() {
			return host.readSession().sessionId;
		},
		get sessionPath() {
			return readAssembly().lifecycle.sessionPath;
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
