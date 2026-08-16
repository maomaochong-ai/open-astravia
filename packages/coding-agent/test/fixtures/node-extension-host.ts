import { createNodeCommandExecutor, createNodeResourceAccess } from "@vetta/runtime-node/host";
import type { EventBus, LoadExtensionsResult } from "../../src/extensions/index.js";
import {
	discoverAndLoadExtensions as discoverWithHost,
	loadExtensions as loadWithHost,
} from "../../src/extensions/index.js";
import type { LoadPiExtensionsResult } from "../../src/extensions/pi-compat/index.js";
import { loadPiExtensions as loadPiWithHost } from "../../src/extensions/pi-compat/index.js";
import { createCodingAgentNodeExtensionFactoryLoader } from "../../src/host/extensions/node-extension-factory-loader.js";

function createHostOptions(cwd: string, eventBus?: EventBus) {
	return {
		cwd,
		resourceAccess: createNodeResourceAccess(),
		factoryLoader: createCodingAgentNodeExtensionFactoryLoader(),
		commandExecutor: createNodeCommandExecutor(),
		...(eventBus ? { eventBus } : {}),
	};
}

export function discoverAndLoadExtensions(
	configuredPaths: readonly string[],
	cwd: string,
	agentDir: string,
	eventBus?: EventBus,
): Promise<LoadExtensionsResult> {
	return discoverWithHost(configuredPaths, { ...createHostOptions(cwd, eventBus), agentDir });
}

export function loadExtensions(
	paths: readonly string[],
	cwd: string,
	eventBus?: EventBus,
): Promise<LoadExtensionsResult> {
	return loadWithHost(paths, createHostOptions(cwd, eventBus));
}

export function loadPiExtensions(
	paths: readonly string[],
	cwd: string,
	eventBus?: EventBus,
): Promise<LoadPiExtensionsResult> {
	const host = createHostOptions(cwd, eventBus);
	return loadPiWithHost(paths, {
		cwd,
		paths: host.resourceAccess.paths,
		factoryLoader: host.factoryLoader,
		commandExecutor: host.commandExecutor,
		...(eventBus ? { eventBus } : {}),
	});
}
