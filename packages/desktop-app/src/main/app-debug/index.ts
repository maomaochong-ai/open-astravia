import { getBatchTaskExecutorState } from "../batch-tasks/batch-task-executor.js";
import { getDesktopBatchTaskService } from "../batch-tasks/batch-task-service.js";
import { getDesktopConversationService } from "../conversations/desktop-conversation-service.js";
import { getDesktopSchedulerService } from "../scheduler/scheduler-service.js";
import { getSchedulerTaskExecutorState } from "../scheduler/task-executor.js";
import { AppDebugCatalog } from "./catalog.js";
import { createConversationDebugDefinitions } from "./conversation/definitions.js";
import { createDebugInfoDefinition } from "./debug-info.js";
import { createLifecycleDebugDefinitions } from "./lifecycle/definitions.js";
import { AppDebugRuntime } from "./runtime.js";
import { createRuntimeCanaryConsumerDefinitions } from "./runtime-canary/consumer-definitions.js";
import { createUiDebugDefinitions } from "./ui/definitions.js";
import type { RendererCdpConfiguration } from "./ui/renderer-cdp.js";

export interface AppDebugRuntimeOptions {
	rendererCdp: RendererCdpConfiguration;
	requestQuit: () => void;
}

export function createAppDebugRuntime(options: AppDebugRuntimeOptions): AppDebugRuntime {
	const catalog = new AppDebugCatalog();
	catalog.register(createDebugInfoDefinition());
	for (const definition of createConversationDebugDefinitions(getDesktopConversationService())) {
		catalog.register(definition);
	}
	for (const definition of createLifecycleDebugDefinitions(options.requestQuit)) {
		catalog.register(definition);
	}
	for (const definition of createRuntimeCanaryConsumerDefinitions({
		scheduler: getDesktopSchedulerService(),
		batch: getDesktopBatchTaskService(),
		readSchedulerState: getSchedulerTaskExecutorState,
		readBatchState: getBatchTaskExecutorState,
	})) {
		catalog.register(definition);
	}
	for (const definition of createUiDebugDefinitions(options.rendererCdp)) {
		catalog.register(definition);
	}
	return new AppDebugRuntime(catalog);
}

export { AppDebugRuntime } from "./runtime.js";
export type { DebugContext, DebugDefinition, DebugMetadata, DebugSearchResult, JsonValue } from "./types.js";
export { DebugError } from "./types.js";
