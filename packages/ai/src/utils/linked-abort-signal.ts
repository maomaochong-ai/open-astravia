export interface LinkedAbortSignal {
	readonly signal: AbortSignal | undefined;
	dispose(): void;
}

export function createLinkedAbortSignal(parent: AbortSignal | undefined): LinkedAbortSignal {
	if (!parent) {
		return { signal: undefined, dispose: () => undefined };
	}

	const controller = new AbortController();
	const abort = () => controller.abort(parent.reason);
	if (parent.aborted) {
		abort();
	} else {
		parent.addEventListener("abort", abort, { once: true });
	}

	return {
		signal: controller.signal,
		dispose: () => parent.removeEventListener("abort", abort),
	};
}
