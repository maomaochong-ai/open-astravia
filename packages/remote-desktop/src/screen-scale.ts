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

/** How far to scale the capture down before encoding: 1 keeps it full size. */
export function screenScaleDown(capture: ScreenSize | undefined, softwareEncoder: boolean): number {
	if (!capture || capture.width <= 0 || capture.height <= 0) return 1;
	let scale = 1;
	if (softwareEncoder) scale = Math.max(scale, Math.sqrt((capture.width * capture.height) / SOFTWARE_MAX_PIXELS));
	return Math.round(scale * 100) / 100;
}
