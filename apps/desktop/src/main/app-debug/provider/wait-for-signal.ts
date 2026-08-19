export function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			signal.removeEventListener("abort", onAbort);
			reject(signal.reason);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		void promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}
