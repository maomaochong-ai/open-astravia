import { getAppLogger } from "../logger.js";
import { AgentBrowserEngine } from "./agent-browser-engine.js";
import { BrowserAutomationService } from "./browser-automation-service.js";
import type { BrowserProcessRunner } from "./browser-process-runner.js";
import { HostBrowserProcessRunner } from "./browser-process-runner.js";
import { BrowserProfileRegistry } from "./browser-profile-registry.js";
import { BrowserRuntimeManager } from "./browser-runtime-manager.js";
import { BrowserSessionRegistry } from "./browser-session-registry.js";
import type { BrowserAutomationLogger } from "./contracts.js";

export { AgentBrowserEngine } from "./agent-browser-engine.js";
export { BrowserAutomationService } from "./browser-automation-service.js";
export {
	assertAllowedBrowserUrl,
	assertReturnedPageAllowed,
} from "./browser-policy.js";
export type { BrowserProcessRunner } from "./browser-process-runner.js";
export { BrowserProcessAbortedError, HostBrowserProcessRunner } from "./browser-process-runner.js";
export { BrowserProfileRegistry } from "./browser-profile-registry.js";
export {
	AGENT_BROWSER_VERSION,
	BrowserRuntimeManager,
} from "./browser-runtime-manager.js";
export { BrowserSessionRegistry, generateSessionId } from "./browser-session-registry.js";
export type {
	BrowserEnginePageResult,
	BrowserEngineSession,
	BrowserProfilePort,
	BrowserRuntimePort,
	BrowserSessionRecord,
	SessionResources,
} from "./contracts.js";
export { BrowserAutomationError } from "./contracts.js";

let singleton: BrowserAutomationService | undefined;

/**
 * 默认 logger：走宿主 AppLogger 统一管理（支持 dev 日志过滤 + 生产持久化）。
 * call site 也可显式传入 BrowserAutomationLogger 做测试 mock。
 */
function defaultLogger(): BrowserAutomationLogger {
	const log = getAppLogger("browser-automation");
	return {
		info: (message, meta) => log.info(message, meta),
		warn: (message, meta) => log.warn(message, meta),
		error: (message, meta) => log.error(message, meta),
	};
}

export function getBrowserAutomationService(
	logger: BrowserAutomationLogger = defaultLogger(),
	processRunner?: BrowserProcessRunner,
): BrowserAutomationService {
	if (singleton) return singleton;
	const runner = processRunner ?? new HostBrowserProcessRunner();
	singleton = new BrowserAutomationService({
		engine: new AgentBrowserEngine(runner),
		runtime: new BrowserRuntimeManager(runner, logger),
		profiles: new BrowserProfileRegistry(),
		sessions: new BrowserSessionRegistry(),
		logger,
	});
	return singleton;
}

/**
 * 关闭所有浏览器会话并释放资源。应在 app shutdown 时调用。
 */
export async function shutdownBrowserAutomation(): Promise<void> {
	if (singleton) {
		await singleton.closeAll();
		singleton = undefined;
	}
}
