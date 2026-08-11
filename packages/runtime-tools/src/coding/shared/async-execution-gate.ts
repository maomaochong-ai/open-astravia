import type { AsyncExecutionGate } from "./desktop-command.js";

/** 创建 FIFO 并发执行门；失败任务也会释放额度。 */
export function createAsyncExecutionGate(maxConcurrent: number): AsyncExecutionGate {
	const limit = Math.max(1, Math.floor(maxConcurrent));
	let active = 0;
	const queue: Array<() => void> = [];

	const pump = (): void => {
		while (active < limit) {
			const start = queue.shift();
			if (!start) return;
			active += 1;
			start();
		}
	};

	return {
		run<T>(operation: () => Promise<T>): Promise<T> {
			return new Promise<T>((resolve, reject) => {
				queue.push(() => {
					operation()
						.then(resolve, reject)
						.finally(() => {
							active -= 1;
							pump();
						});
				});
				pump();
			});
		},
	};
}
