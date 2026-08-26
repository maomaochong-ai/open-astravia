import {
	InMemoryRuntimeSessionMarkerIndex,
	InMemoryRuntimeSessionValueIndex,
	type RuntimeResourceContext,
} from "@vetta/runtime-core";
import type { McpDeferredToolController } from "@vetta/runtime-mcp";
import type { CodingAgentSessionExecutionRuntime } from "../../execution/session/runtime.js";
import type { CodingAgentExtensionRunBridge } from "../../extensions/runtime/extension-run-bridge.js";
import type { CodingAgentSessionConfigurationState } from "../../host/session-configuration/configuration-state.js";
import type { CodingAgentMemoryController } from "../../memory/index.js";
import type { CodingAgentPluginMcpRuntime } from "../../runtime-contracts/index.js";
import type { CodingAgentSessionHookController, CodingAgentSessionResourceIndexes } from "./resource-lifecycle.js";

/** Composition 级 Session 查询索引；资源生命周期只由各 Agent Session Plan 持有。 */
export class CodingAgentCompositionResourceRegistry {
	readonly indexes: CodingAgentSessionResourceIndexes = {
		mcpControllers: new InMemoryRuntimeSessionValueIndex<McpDeferredToolController>(),
		pluginMcpRuntimes: new InMemoryRuntimeSessionValueIndex<CodingAgentPluginMcpRuntime>(),
		executionRuntimes: new InMemoryRuntimeSessionValueIndex<CodingAgentSessionExecutionRuntime>(),
		configurationStates: new InMemoryRuntimeSessionValueIndex<CodingAgentSessionConfigurationState>(),
		resourceContexts: new InMemoryRuntimeSessionValueIndex<RuntimeResourceContext>(),
		extensionEventBridges: new InMemoryRuntimeSessionValueIndex<CodingAgentExtensionRunBridge>(),
		memoryControllers: new InMemoryRuntimeSessionValueIndex<CodingAgentMemoryController>(),
		hookSessionControllers: new InMemoryRuntimeSessionValueIndex<CodingAgentSessionHookController>(),
		mcpRefreshObservedSessions: new InMemoryRuntimeSessionMarkerIndex(),
	};

	clear(): void {
		for (const index of Object.values(this.indexes)) index.clear();
	}
}
