import type { RuntimeHostPathServices, RuntimeQueueSidecarStore, RuntimeSandboxGrantStore } from "@vetta/runtime-core";
import { nodeRuntimeHostPathServices, nodeRuntimeQueueSidecarStore } from "@vetta/runtime-node/host";
import { nodeSandboxGrantStore } from "@vetta/runtime-node/sandbox";

export interface DesktopRuntimeHostPlatformServices {
	readonly pathServices: RuntimeHostPathServices;
	readonly queueSidecarStore: RuntimeQueueSidecarStore;
	readonly sandboxGrantStore: RuntimeSandboxGrantStore;
}

/** Desktop's explicit Node host capability bundle for RuntimeHost composition. */
export function createDesktopRuntimeHostPlatformServices(): DesktopRuntimeHostPlatformServices {
	return {
		pathServices: nodeRuntimeHostPathServices,
		queueSidecarStore: nodeRuntimeQueueSidecarStore,
		sandboxGrantStore: nodeSandboxGrantStore,
	};
}
