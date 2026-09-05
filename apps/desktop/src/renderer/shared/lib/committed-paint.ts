export type PaintBarrierResult = "painted" | "skipped-hidden" | "timeout";

/**
 * Let React commit and the browser present the current UI before starting
 * secondary work that can contend for the renderer or main-process event loop.
 */
export function waitForCommittedPaint(): Promise<PaintBarrierResult> {
	if (document.visibilityState === "hidden") return Promise.resolve("skipped-hidden");
	if (typeof window.requestAnimationFrame !== "function") {
		return new Promise((resolve) => window.setTimeout(() => resolve("timeout"), 0));
	}
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: PaintBarrierResult): void => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timeoutId);
			resolve(result);
		};
		const timeoutId = window.setTimeout(() => finish("timeout"), 100);
		window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => finish("painted"));
		});
	});
}
