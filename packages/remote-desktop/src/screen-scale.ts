/** A capture or picture size, in pixels. */
export interface ScreenSize {
	readonly width: number;
	readonly height: number;
}

/**
 * The most pixels the software encoder is given. Chromium falls back to it (OpenH264) when
 * the hardware encoder fails, and a 2560x1600 frame then takes tens of ms to encode: the
 * picture drops to a few frames a second and falls behind. 1920x1200 is about half the work.
 */
const SOFTWARE_MAX_PIXELS = 1920 * 1200;

/** Encoders Chromium runs on the CPU; anything else is taken as hardware. */
export function isSoftwareEncoder(implementation: string): boolean {
	return /openh264|libvpx|libaom/i.test(implementation);
}

/**
 * The steps the picture is sent smaller by to fit the phone. Few, so a pinch moving the
 * zoom a little does not change the size (each change costs a full frame); at most half,
 * so zooming in is still sharp while the larger picture is on its way.
 */
const VIEW_STEPS = [1, 1.25, 1.5, 2] as const;

/**
 * How far to scale the capture down before encoding: 1 keeps it full size. `shown` is how
 * large the phone shows the whole screen, in its pixels: nothing beyond that is sent.
 */
export function screenScaleDown(capture: ScreenSize | undefined, softwareEncoder: boolean, shown?: ScreenSize): number {
	if (!capture || capture.width <= 0 || capture.height <= 0) return 1;
	let scale = 1;
	if (shown) {
		const fits = Math.min(capture.width / shown.width, capture.height / shown.height);
		scale = VIEW_STEPS.reduce((best, step) => (step <= fits ? step : best), 1);
	}
	if (softwareEncoder) scale = Math.max(scale, Math.sqrt((capture.width * capture.height) / SOFTWARE_MAX_PIXELS));
	return Math.round(scale * 100) / 100;
}
