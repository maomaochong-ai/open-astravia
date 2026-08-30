import { DesktopMcpAppRegistry } from "./mcp-app-registry.js";
import { getDesktopMcpTaskCoordinator } from "./mcp-task-runtime.js";

const registry = new DesktopMcpAppRegistry({ taskCoordinator: getDesktopMcpTaskCoordinator() });

export function getDesktopMcpAppRegistry(): DesktopMcpAppRegistry {
	return registry;
}
