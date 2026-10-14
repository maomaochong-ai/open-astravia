import type { ScreenSize } from "./screen-scale.js";
import { screenScaleDown } from "./screen-scale.js";
import type { ScreenStreamSample } from "./screen-stats.js";

export const SCREEN_TARGET_FPS = 30;

/** Fast reduction, slow recovery. Low FPS alone is not evidence of overload on a still desktop. */
export class ScreenAdaptation {
	private adaptiveScale = 1;
	private pressureSince: number | undefined;
	private healthySince: number | undefined;
	private lastSample: number | undefined;
	private lastChange = -Infinity;

	reset(): void {
		this.adaptiveScale = 1;
		this.pressureSince = undefined;
		this.healthySince = undefined;
		this.lastSample = undefined;
		this.lastChange = -Infinity;
	}

	scale(capture: ScreenSize | undefined, software: boolean, shown?: ScreenSize): number {
		return Math.max(screenScaleDown(capture, software, shown), this.adaptiveScale);
	}

	observe(sample: ScreenStreamSample, capture: ScreenSize | undefined, software: boolean, shown?: ScreenSize): void {
		if (!capture || !Number.isFinite(sample.timestamp)) return;
		const now = sample.timestamp;
		if (this.lastSample !== undefined && now <= this.lastSample) return;
		if (this.lastSample !== undefined && now - this.lastSample > 2500) {
			this.pressureSince = undefined;
			this.healthySince = undefined;
		}
		this.lastSample = now;
		const fps = sample.encodedFps ?? sample.sentFps ?? 0;
		const moving = Math.max(sample.sourceFps ?? 0, fps) >= 15;
		const pressure =
			moving &&
			(sample.limitedBy === "cpu" ||
				sample.limitedBy === "bandwidth" ||
				(sample.encodeMs ?? 0) > 28 ||
				(sample.packetSendDelayMs ?? 0) > 80 ||
				((sample.sourceFps ?? 0) >= 25 && fps < 24));
		const headroom =
			sample.availableKbps === undefined ||
			sample.sentKbps === undefined ||
			sample.availableKbps >= sample.sentKbps * 1.3;
		const healthy =
			moving &&
			fps >= 27 &&
			sample.limitedBy === "none" &&
			sample.encodeMs !== undefined &&
			sample.encodeMs < 20 &&
			(sample.packetSendDelayMs ?? 0) < 40 &&
			headroom;
		this.pressureSince = pressure ? (this.pressureSince ?? now) : undefined;
		this.healthySince = healthy ? (this.healthySince ?? now) : undefined;
		const base = screenScaleDown(capture, software, shown);
		const current = this.scale(capture, software, shown);
		// Avoid shrinking below a usable 640x360 bounding box, or enlarging a small source.
		const maximum = Math.max(base, Math.min(capture.width / 640, capture.height / 360));
		if (this.pressureSince !== undefined && now - this.pressureSince >= 2000 && now - this.lastChange >= 3000) {
			this.adaptiveScale = Math.min(maximum, current * 1.25);
			this.lastChange = now;
			this.pressureSince = undefined;
		} else if (
			this.healthySince !== undefined &&
			now - this.healthySince >= 10_000 &&
			now - this.lastChange >= 10_000
		) {
			this.adaptiveScale = Math.max(1, this.adaptiveScale / 1.25);
			this.lastChange = now;
			this.healthySince = undefined;
		}
	}
}
