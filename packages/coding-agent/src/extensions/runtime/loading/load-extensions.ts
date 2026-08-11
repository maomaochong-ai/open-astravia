import { getAgentDir } from "../../../config.js";
import type { EventBus } from "../../infrastructure.js";
import type { Extension, LoadExtensionsResult } from "../../runtime-contracts.js";
import { discoverExtensionPaths } from "../discovery/extension-paths.js";
import { createExtensionEventBus } from "../event-bus.js";
import { loadExtensionFromPath } from "../registration/extension-registration.js";
import { createExtensionRuntime } from "../runtime-state.js";

export async function loadExtensions(paths: string[], cwd: string, eventBus?: EventBus): Promise<LoadExtensionsResult> {
	const extensions: Extension[] = [];
	const errors: Array<{ path: string; error: string }> = [];
	const resolvedEventBus = eventBus ?? createExtensionEventBus();
	const runtime = createExtensionRuntime();

	for (const extensionPath of paths) {
		const result = await loadExtensionFromPath(extensionPath, cwd, resolvedEventBus, runtime);
		if (result.error) {
			errors.push({ path: extensionPath, error: result.error });
		} else if (result.extension) {
			extensions.push(result.extension);
		}
	}

	return { extensions, errors, runtime };
}

export async function discoverAndLoadExtensions(
	configuredPaths: string[],
	cwd: string,
	agentDir: string = getAgentDir(),
	eventBus?: EventBus,
): Promise<LoadExtensionsResult> {
	return loadExtensions(discoverExtensionPaths(configuredPaths, cwd, agentDir), cwd, eventBus);
}
