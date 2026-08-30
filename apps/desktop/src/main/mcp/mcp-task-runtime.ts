import { McpTaskExecutionCoordinator } from "@vetta/runtime-mcp";
import { getAppLogger } from "../logger.js";
import { DesktopMcpTaskRegistry } from "./mcp-task-registry.js";

const registry = new DesktopMcpTaskRegistry();
let log: ReturnType<typeof getAppLogger> | undefined;

const coordinator = new McpTaskExecutionCoordinator({
	store: registry,
	onDiagnostic(message) {
		try {
			log ??= getAppLogger("mcp");
			if (/failed|error|deferred/i.test(message)) log.warn(message);
			else log.debug(message);
		} catch {
			// Lightweight test hosts may not configure Electron logging.
		}
	},
});

export function getDesktopMcpTaskRegistry(): DesktopMcpTaskRegistry {
	return registry;
}

export function getDesktopMcpTaskCoordinator(): McpTaskExecutionCoordinator {
	return coordinator;
}
