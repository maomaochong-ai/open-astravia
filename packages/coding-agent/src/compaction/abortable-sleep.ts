/** Wait for a duration while honoring cancellation. */
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Aborted"));
			return;
		}

		let timeout: ReturnType<typeof setTimeout>;
		const cleanup = () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
		};
		const onAbort = () => {
			cleanup();
			reject(new Error("Aborted"));
		};

		timeout = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
