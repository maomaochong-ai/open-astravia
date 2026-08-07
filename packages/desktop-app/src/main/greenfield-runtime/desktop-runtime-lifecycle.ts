export type DesktopRuntimeLifecycleState = "idle" | "running" | "stopping" | "stopped";

export interface DesktopRuntimeFailure {
	readonly errorCode: "runtime_startup_failed" | "runtime_shutdown_failed";
	readonly phase: "startup" | "shutdown";
	readonly recoverability: "retry_safe" | "restart_session";
	readonly message: string;
	readonly occurredAt: string;
}

export interface DesktopRuntimeHealth {
	readonly state: DesktopRuntimeLifecycleState;
	readonly lastFailure?: DesktopRuntimeFailure;
}

export class DesktopRuntimeLifecycle {
	private currentState: DesktopRuntimeLifecycleState = "idle";
	private currentFailure: DesktopRuntimeFailure | undefined;

	get state(): DesktopRuntimeLifecycleState {
		return this.currentState;
	}

	snapshot(): DesktopRuntimeHealth {
		return {
			state: this.currentState,
			...(this.currentFailure ? { lastFailure: { ...this.currentFailure } } : {}),
		};
	}

	recordFailure(failure: Omit<DesktopRuntimeFailure, "occurredAt">): void {
		this.currentFailure = { ...failure, occurredAt: new Date().toISOString() };
	}

	assertCanAccessRuntime(): void {
		if (this.currentState === "stopping" || this.currentState === "stopped") {
			throw new Error(`Desktop RuntimeHost is ${this.currentState}`);
		}
	}

	markRunning(): void {
		this.assertCanAccessRuntime();
		this.currentState = "running";
		this.currentFailure = undefined;
	}

	beginShutdown(): void {
		if (this.currentState === "stopping" || this.currentState === "stopped") return;
		this.currentState = "stopping";
	}

	markStopped(): void {
		this.currentState = "stopped";
	}
}
