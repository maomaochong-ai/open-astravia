import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { getAppLogger } from "../logger.js";
import { AgentBrowserEngine } from "./agent-browser-engine.js";
import { BrowserAutomationService } from "./browser-automation-service.js";
import { HostBrowserProcessRunner } from "./browser-process-runner.js";
import { BrowserProfileRegistry } from "./browser-profile-registry.js";
import { BrowserRuntimeManager } from "./browser-runtime-manager.js";

export { BrowserAutomationService } from "./browser-automation-service.js";
export { BrowserAutomationError } from "./contracts.js";

let sharedService: BrowserAutomationService | undefined;

export function getBrowserAutomationService(): BrowserAutomationService {
	if (sharedService) return sharedService;
	const log = getAppLogger("browser-automation");
	const processRunner = new HostBrowserProcessRunner();
	const logger = {
		info: (message: string, fields?: Record<string, unknown>) => log.info(message, fields),
		warn: (message: string, fields?: Record<string, unknown>) => log.warn(message, fields),
		error: (message: string, fields?: Record<string, unknown>) => log.error(message, fields),
	};
	sharedService = new BrowserAutomationService({
		engine: new AgentBrowserEngine(processRunner),
		runtime: new BrowserRuntimeManager(processRunner, logger),
		profiles: new BrowserProfileRegistry({
			legacyBrowserPluginProfile: join(getVettaHomePath(), "plugin-data", "browser", "profile"),
			logger,
		}),
		logger,
	});
	return sharedService;
}
