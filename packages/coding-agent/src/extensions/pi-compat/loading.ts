import type { EventBus } from "../infrastructure.js";
import { resolveExtensionPath } from "../runtime/discovery/extension-paths.js";
import { createExtensionEventBus } from "../runtime/event-bus.js";
import { loadExtensionFactory } from "../runtime/loading/extension-module-loader.js";
import { loadExtensionFromFactory } from "../runtime/registration/extension-registration.js";
import { createExtensionRuntime } from "../runtime/runtime-state.js";
import type { Extension, ExtensionRuntime } from "../runtime-contracts.js";
import {
	PI_EXTENSION_COMPATIBILITY_PROFILE,
	type PiCompatibleExtensionFactory,
	type PiExtensionCompatibilityFeature,
	type PiExtensionCompatibilityReport,
} from "./contracts.js";
import { adaptPiExtensionFactory } from "./factory-adapter.js";

export interface LoadPiExtensionsResult {
	readonly extensions: Extension[];
	readonly errors: Array<{ readonly path: string; readonly error: string }>;
	readonly runtime: ExtensionRuntime;
	readonly compatibilityReports: readonly PiExtensionCompatibilityReport[];
}

export async function loadPiExtensions(
	paths: readonly string[],
	cwd: string,
	eventBus?: EventBus,
): Promise<LoadPiExtensionsResult> {
	const extensions: Extension[] = [];
	const errors: Array<{ path: string; error: string }> = [];
	const compatibilityReports: PiExtensionCompatibilityReport[] = [];
	const runtime = createExtensionRuntime();
	const resolvedEventBus = eventBus ?? createExtensionEventBus();

	for (const extensionPath of paths) {
		const resolvedPath = resolveExtensionPath(extensionPath, cwd);
		const features: PiExtensionCompatibilityFeature[] = [];
		try {
			const factory = await loadExtensionFactory(resolvedPath, "pi");
			if (!factory) {
				errors.push({ path: extensionPath, error: "Pi extension does not export a valid factory function" });
				continue;
			}
			const extension = await loadExtensionFromFactory(
				adaptPiExtensionFactory(factory as unknown as PiCompatibleExtensionFactory, (feature) =>
					features.push(feature),
				),
				cwd,
				resolvedEventBus,
				runtime,
				extensionPath,
				resolvedPath,
			);
			extensions.push(extension);
			compatibilityReports.push({
				extensionPath,
				profile: PI_EXTENSION_COMPATIBILITY_PROFILE,
				features: Object.freeze([...features]),
			});
		} catch (error) {
			errors.push({
				path: extensionPath,
				error: `Failed to load Pi extension: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	return { extensions, errors, runtime, compatibilityReports };
}
