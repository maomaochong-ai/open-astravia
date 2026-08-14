import type { RuntimeHost } from "@vetta/runtime-core";
import { DesktopRuntimeController, type DesktopRuntimeHealth } from "@vetta/runtime-desktop";
import { createDesktopRuntimeComposition } from "./agent-runtime/composition.js";

// 进程级共享 RuntimeHost：session IPC、定时任务与批量任务必须复用同一实例，
// 避免同一进程重复申请 Session 文件锁。
const desktopRuntime = new DesktopRuntimeController(createDesktopRuntimeComposition);

export function peekSharedRuntime(): RuntimeHost | null {
	return desktopRuntime.peek();
}

export function getSharedRuntimeHealth(): DesktopRuntimeHealth {
	return desktopRuntime.health();
}

export function getSharedRuntime(): RuntimeHost {
	return desktopRuntime.get();
}

export function beginSharedRuntimeShutdown(): void {
	desktopRuntime.beginShutdown();
}

export async function disposeSharedRuntime(): Promise<void> {
	return await desktopRuntime.dispose();
}
