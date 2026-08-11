import type { ExtensionContext } from "../../context-contracts.js";
import type { ExtensionError } from "../../runtime-contracts.js";
import type { ExtensionContextHost } from "../context/extension-context-host.js";
import type { ExtensionHandlerRegistration, ExtensionRegistry } from "../registry/extension-registry.js";

export interface ExtensionDispatchEnvironment {
	handlers(eventType: string): ExtensionHandlerRegistration[];
	context(): ExtensionContext;
	report(extensionPath: string, event: string, error: unknown): void;
}

export function createDispatchEnvironment(
	registry: ExtensionRegistry,
	contextHost: ExtensionContextHost,
	emitError: (error: ExtensionError) => void,
): ExtensionDispatchEnvironment {
	return {
		handlers: (eventType) => registry.getHandlers(eventType),
		context: () => contextHost.createContext(),
		report: (extensionPath, event, error) => {
			emitError({
				extensionPath,
				event,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
		},
	};
}
