export { createExtensionEventBus, type ExtensionEventBusController } from "./event-bus.js";
export type {
	ExtensionErrorListener,
	ForkHandler,
	NavigateTreeHandler,
	NewSessionHandler,
	ReloadHandler,
	ShutdownHandler,
	SwitchSessionHandler,
} from "./extension-runner.js";
export { ExtensionRunner, emitSessionShutdownEvent } from "./extension-runner.js";
export {
	discoverAndLoadExtensions,
	loadExtensions,
} from "./loading/load-extensions.js";
export { loadExtensionFromFactory } from "./registration/extension-registration.js";
export { createExtensionRuntime } from "./runtime-state.js";
export type { ExtensionToolPipelineHost } from "./tool-pipeline.js";
export {
	wrapRegisteredTool,
	wrapRegisteredTools,
	wrapToolsWithExtensions,
	wrapToolWithExtensions,
} from "./tool-pipeline.js";
