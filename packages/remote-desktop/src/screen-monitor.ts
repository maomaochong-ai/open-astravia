import type { ScreenStreamSample } from "./screen-stats.js";

/** Sample every second, log every five; slow getStats never creates overlapping polls. */
export function watchScreenStream(
	sample: () => Promise<ScreenStreamSample | undefined>,
	onSample: (sample: ScreenStreamSample) => void,
	onError: (error: unknown) => void,
): () => void {
	let stopped = false;
	let lastLog: number | undefined;
	let timer: ReturnType<typeof setTimeout>;
	const poll = async (): Promise<void> => {
		try {
			const next = await sample();
			if (!stopped && next && (lastLog === undefined || next.timestamp - lastLog >= 5000)) {
				lastLog = next.timestamp;
				onSample(next);
			}
		} catch (error) {
			if (!stopped) onError(error);
		} finally {
			if (!stopped) timer = setTimeout(() => void poll(), 1000);
		}
	};
	timer = setTimeout(() => void poll(), 1000);
	return () => {
		stopped = true;
		clearTimeout(timer);
	};
}
