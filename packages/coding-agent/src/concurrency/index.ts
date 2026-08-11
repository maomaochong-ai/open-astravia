/** A minimal FIFO concurrency limiter with no external dependencies. */
export interface Limiter {
	run<T>(operation: () => Promise<T>): Promise<T>;
}

export function createLimiter(max: number): Limiter {
	const limit = Math.max(1, Math.floor(max));
	let active = 0;
	const queue: Array<() => void> = [];

	const pump = (): void => {
		if (active >= limit) return;
		const start = queue.shift();
		if (!start) return;
		active += 1;
		start();
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
