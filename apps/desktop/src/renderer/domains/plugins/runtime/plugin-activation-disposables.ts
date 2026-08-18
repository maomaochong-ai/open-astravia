import type { Disposable } from "@vetta-org/plugin-sdk";

export function trackActivationDisposable(disposable: Disposable, disposers: Array<() => void>): Disposable {
	let disposed = false;
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		disposable.dispose();
	};
	disposers.push(dispose);
	return { dispose };
}
