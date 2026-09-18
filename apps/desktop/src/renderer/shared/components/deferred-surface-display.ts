export type DeferredSurfacePhase = "visible" | "leaving" | "hidden";

/**
 * 工作台切页：入场立刻占 flex 槽；离场先脱离文档流叠一帧，再 `[hidden]`。
 * 设置标签不走叠层，直接 hidden。
 */
export function deferredSurfacePhase(input: { active: boolean; leaving: boolean }): DeferredSurfacePhase {
	if (input.active) return "visible";
	if (input.leaving) return "leaving";
	return "hidden";
}

export function deferredSurfaceRootClassName(phase: DeferredSurfacePhase): string {
	switch (phase) {
		case "visible":
			return "flex min-h-0 min-w-0 flex-1 flex-col";
		case "leaving":
			return "pointer-events-none absolute inset-0 z-[1] flex min-h-0 min-w-0 flex-col";
		case "hidden":
			return "pointer-events-none [&_*]:[animation-play-state:paused]";
	}
}

export function shouldStartStackLeave(active: boolean, stackLeave: boolean, wasActive: boolean): boolean {
	return stackLeave && wasActive && !active;
}

/** 切回已经挂着的保活页时不要叠离场帧，否则会盖住目标页。 */
export function keepAliveShouldStackLeave(incomingAlreadyMounted: boolean): boolean {
	return !incomingAlreadyMounted;
}
