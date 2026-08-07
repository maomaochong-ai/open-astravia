import type { RuntimeHost } from "../../../runtime-core/src/index.js";
import type { DesktopRuntimeBackendPool } from "./agent-runtime/backend-pool.js";
import { createDesktopRuntimeComposition } from "./agent-runtime/composition.js";
import { type DesktopRuntimeHealth, DesktopRuntimeLifecycle } from "./agent-runtime/lifecycle.js";

// 进程级共享 RuntimeHost：session IPC、定时任务与批量任务必须复用同一实例，
// 避免同一进程重复申请 Session 文件锁。
let sharedRuntime: RuntimeHost | null = null;
let sharedRuntimeBackendPool: DesktopRuntimeBackendPool | null = null;
let sharedRuntimeShutdownPromise: Promise<void> | null = null;
const sharedRuntimeLifecycle = new DesktopRuntimeLifecycle();

export function peekSharedRuntime(): RuntimeHost | null {
	return sharedRuntime;
}

export function getSharedRuntimeHealth(): DesktopRuntimeHealth {
	return sharedRuntimeLifecycle.snapshot();
}

export function getSharedRuntime(): RuntimeHost {
	sharedRuntimeLifecycle.assertCanAccessRuntime();
	if (!sharedRuntime) {
		try {
			const composition = createDesktopRuntimeComposition();
			sharedRuntime = composition.runtime;
			sharedRuntimeBackendPool = composition.runtimeBackendPool;
			sharedRuntimeLifecycle.markRunning();
		} catch (error) {
			sharedRuntimeLifecycle.recordFailure({
				errorCode: "runtime_startup_failed",
				phase: "startup",
				recoverability: "retry_safe",
				message: errorMessage(error),
			});
			throw error;
		}
	}
	return sharedRuntime;
}

export function beginSharedRuntimeShutdown(): void {
	sharedRuntimeLifecycle.beginShutdown();
}

export async function disposeSharedRuntime(): Promise<void> {
	beginSharedRuntimeShutdown();
	if (sharedRuntimeShutdownPromise) return await sharedRuntimeShutdownPromise;
	const runtime = sharedRuntime;
	const runtimeBackendPool = sharedRuntimeBackendPool;
	sharedRuntime = null;
	sharedRuntimeBackendPool = null;
	sharedRuntimeShutdownPromise = (async () => {
		try {
			try {
				await runtime?.disposeAllSessions();
			} finally {
				try {
					await runtimeBackendPool?.dispose();
				} finally {
					sharedRuntimeLifecycle.markStopped();
				}
			}
		} catch (error) {
			sharedRuntimeLifecycle.recordFailure({
				errorCode: "runtime_shutdown_failed",
				phase: "shutdown",
				recoverability: "restart_session",
				message: errorMessage(error),
			});
			throw error;
		}
	})();
	return await sharedRuntimeShutdownPromise;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
