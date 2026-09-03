import type { TeamTaskSnapshot, TeamWaitTasksResult } from "@vetta/agent-team";

/** Installs the listener before reading to close the completion/admission race. */
export function waitForTeamTasks(input: {
	readonly read: () => readonly TeamTaskSnapshot[];
	readonly subscribe: (listener: () => void) => () => void;
	readonly signal: AbortSignal;
	readonly timeoutMs: number;
}): Promise<TeamWaitTasksResult> {
	input.signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		let settled = false;
		let unsubscribe: (() => void) | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			settled = true;
			unsubscribe?.();
			if (timer !== undefined) clearTimeout(timer);
			input.signal.removeEventListener("abort", abort);
		};
		const fail = (error: unknown) => {
			if (!settled) {
				cleanup();
				reject(error);
			}
		};
		const read = (timeout: boolean) => {
			if (settled) return;
			try {
				const tasks = input.read();
				if (tasks.some((task) => task.workItem.state !== "running" && task.workItem.state !== "queued")) {
					cleanup();
					resolve({ reason: "state-changed", tasks });
				} else if (timeout) {
					cleanup();
					resolve({ reason: "timeout", tasks });
				}
			} catch (error) {
				fail(error);
			}
		};
		const abort = () => fail(input.signal.reason);
		input.signal.addEventListener("abort", abort, { once: true });
		try {
			unsubscribe = input.subscribe(() => read(false));
		} catch (error) {
			fail(error);
		}
		if (settled) {
			unsubscribe?.();
			return;
		}
		read(input.timeoutMs === 0);
		if (!settled) timer = setTimeout(() => read(true), input.timeoutMs);
	});
}
