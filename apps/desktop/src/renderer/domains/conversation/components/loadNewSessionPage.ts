function importNewSessionPage() {
	return import("./NewSessionPage").then((module) => ({ default: module.NewSessionPage }));
}

export function createRetryableLoader<T>(load: () => Promise<T>): () => Promise<T> {
	let promise: Promise<T> | null = null;
	return () => {
		promise ??= load().catch((error: unknown) => {
			promise = null;
			throw error;
		});
		return promise;
	};
}

export const loadNewSessionPage = createRetryableLoader(importNewSessionPage);
