import type { ResourceAccessPort } from "../../../resources/contracts/resource-access.js";
import type { ExtensionCommandExecutor, ExtensionFactoryLoader } from "../../host-contracts.js";
import type { EventBus } from "../../infrastructure.js";
import type { Extension, LoadExtensionsResult } from "../../runtime-contracts.js";
import { discoverExtensionPaths } from "../discovery/extension-paths.js";
import { createExtensionEventBus } from "../event-bus.js";
import { loadExtensionFromPath } from "../registration/extension-registration.js";
import { createExtensionRuntime } from "../runtime-state.js";

export interface LoadExtensionsOptions {
	readonly cwd: string;
	readonly resourceAccess: ResourceAccessPort;
	readonly factoryLoader: ExtensionFactoryLoader;
	readonly commandExecutor: ExtensionCommandExecutor;
	readonly eventBus?: EventBus;
	readonly signal?: AbortSignal;
}

export interface DiscoverAndLoadExtensionsOptions extends LoadExtensionsOptions {
	readonly agentDir: string;
}

export async function loadExtensions(
	paths: readonly string[],
	options: LoadExtensionsOptions,
): Promise<LoadExtensionsResult> {
	const extensions: Extension[] = [];
	const errors: Array<{ path: string; error: string }> = [];
	const eventBus = options.eventBus ?? createExtensionEventBus();
	const runtime = createExtensionRuntime();

	for (const extensionPath of paths) {
		options.signal?.throwIfAborted();
		const result = await loadExtensionFromPath(extensionPath, options.cwd, eventBus, runtime, {
			paths: options.resourceAccess.paths,
			factoryLoader: options.factoryLoader,
			commandExecutor: options.commandExecutor,
			signal: options.signal,
		});
		if (result.error) errors.push({ path: extensionPath, error: result.error });
		else if (result.extension) extensions.push(result.extension);
	}

	return { extensions, errors, runtime };
}

export async function discoverAndLoadExtensions(
	configuredPaths: readonly string[],
	options: DiscoverAndLoadExtensionsOptions,
): Promise<LoadExtensionsResult> {
	const paths = await discoverExtensionPaths({
		resourceAccess: options.resourceAccess,
		configuredPaths,
		cwd: options.cwd,
		agentDir: options.agentDir,
		signal: options.signal,
	});
	return loadExtensions(paths, options);
}
