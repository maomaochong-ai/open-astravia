export const PLUGIN_TOOL_RENDERER_LOADING_MESSAGE = "Plugin host renderer is loading; retry the tool after it is ready";

type PluginToolRendererHostState = "loading" | "ready" | "unavailable" | "disposed";

export type PluginToolRendererInvocationLease =
	| { readonly ok: true; release(): void }
	| { readonly ok: false; readonly error: Error };

/**
 * Owns the document-scoped renderer availability contract for plugin tool IPC.
 * Contribution registrations may survive a renderer reload, but their handlers do not.
 */
export class PluginToolRendererHostLifecycle {
	private state: PluginToolRendererHostState = "loading";
	private readonly pendingInvocationFailures = new Set<(error: Error) => void>();

	markReady(): void {
		if (this.state !== "disposed") this.state = "ready";
	}

	markLoading(): void {
		if (this.state === "disposed") return;
		this.transitionTo("loading", PLUGIN_TOOL_RENDERER_LOADING_MESSAGE);
	}

	markUnavailable(): void {
		if (this.state === "disposed") return;
		this.transitionTo("unavailable", "Plugin host renderer is unavailable");
	}

	dispose(): void {
		this.transitionTo("disposed", "Plugin host renderer was disposed");
	}

	acquire(onUnavailable: (error: Error) => void): PluginToolRendererInvocationLease {
		const rejection = this.readInvocationRejection();
		if (rejection) return { ok: false, error: rejection };
		this.pendingInvocationFailures.add(onUnavailable);
		return {
			ok: true,
			release: () => this.pendingInvocationFailures.delete(onUnavailable),
		};
	}

	private readInvocationRejection(): Error | undefined {
		switch (this.state) {
			case "ready":
				return undefined;
			case "loading":
				return new Error(PLUGIN_TOOL_RENDERER_LOADING_MESSAGE);
			case "unavailable":
				return new Error("Plugin host renderer is unavailable");
			case "disposed":
				return new Error("Plugin host renderer was disposed");
		}
	}

	private transitionTo(state: PluginToolRendererHostState, message: string): void {
		this.state = state;
		const failures = [...this.pendingInvocationFailures];
		this.pendingInvocationFailures.clear();
		for (const fail of failures) fail(new Error(message));
	}
}
