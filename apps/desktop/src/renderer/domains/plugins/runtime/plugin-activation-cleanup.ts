import type { PluginActivationCleanup } from "@vetta-org/plugin-sdk";

/** Captures cleanup ownership for one loadPlugin() activation. */
export class PluginActivationCleanupController {
	private cleanup: PluginActivationCleanup | undefined;
	private disposed = false;

	set(cleanup: undefined | PluginActivationCleanup): void {
		this.cleanup = cleanup || undefined;
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		if (typeof this.cleanup === "function") {
			await this.cleanup();
			return;
		}
		this.cleanup?.dispose();
	}
}
