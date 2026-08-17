import type { RuntimeHost } from "@vetta/runtime-core";
import { type DesktopRuntimeHealth, DesktopRuntimeLifecycle } from "./lifecycle.js";

export interface DesktopRuntimeBackendPoolHandle {
	dispose(): Promise<void>;
}

export interface DesktopRuntimeComposition {
	readonly runtime: RuntimeHost;
	readonly runtimeBackendPool: DesktopRuntimeBackendPoolHandle;
}

export type DesktopRuntimeCompositionFactory = () => DesktopRuntimeComposition;

/** Owns the single Desktop process Runtime and its ordered shutdown transaction. */
export class DesktopRuntimeController {
	private runtime: RuntimeHost | null = null;
	private runtimeBackendPool: DesktopRuntimeBackendPoolHandle | null = null;
	private shutdownPromise: Promise<void> | null = null;
	private readonly lifecycle = new DesktopRuntimeLifecycle();

	constructor(private readonly createComposition: DesktopRuntimeCompositionFactory) {}

	peek(): RuntimeHost | null {
		return this.runtime;
	}

	health(): DesktopRuntimeHealth {
		return this.lifecycle.snapshot();
	}

	get(): RuntimeHost {
		this.lifecycle.assertCanAccessRuntime();
		if (this.runtime) return this.runtime;

		try {
			const composition = this.createComposition();
			this.runtime = composition.runtime;
			this.runtimeBackendPool = composition.runtimeBackendPool;
			this.lifecycle.markRunning();
			return composition.runtime;
		} catch (error) {
			this.lifecycle.recordFailure({
				errorCode: "runtime_startup_failed",
				phase: "startup",
				recoverability: "retry_safe",
				message: errorMessage(error),
			});
			throw error;
		}
	}

	beginShutdown(): void {
		this.lifecycle.beginShutdown();
	}

	async dispose(): Promise<void> {
		this.beginShutdown();
		if (this.shutdownPromise) return await this.shutdownPromise;

		const runtime = this.runtime;
		const runtimeBackendPool = this.runtimeBackendPool;
		this.runtime = null;
		this.runtimeBackendPool = null;
		this.shutdownPromise = this.disposeOwnedResources(runtime, runtimeBackendPool);
		return await this.shutdownPromise;
	}

	private async disposeOwnedResources(
		runtime: RuntimeHost | null,
		runtimeBackendPool: DesktopRuntimeBackendPoolHandle | null,
	): Promise<void> {
		try {
			try {
				await runtime?.disposeAllSessions();
			} finally {
				try {
					await runtimeBackendPool?.dispose();
				} finally {
					this.lifecycle.markStopped();
				}
			}
		} catch (error) {
			this.lifecycle.recordFailure({
				errorCode: "runtime_shutdown_failed",
				phase: "shutdown",
				recoverability: "restart_session",
				message: errorMessage(error),
			});
			throw error;
		}
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
