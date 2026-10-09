import type { RemoteDesktopLogger } from "./peer-types.js";
import { SCREEN_TARGET_FPS, ScreenAdaptation } from "./screen-adaptation.js";
import type { ScreenSize } from "./screen-scale.js";
import { evenScreenScale, isSoftwareEncoder } from "./screen-scale.js";
import type { ScreenStreamSample } from "./screen-stats.js";
import { ScreenStatsSampler } from "./screen-stats.js";

const SCREEN_MAX_BITRATE = 12_000_000;

/** Owns all video sender mutations; input/control channels never participate in recovery. */
export class ScreenSender {
	private queue = Promise.resolve();
	private closed = false;
	private software = false;
	private encoder: string | undefined;
	private shown: ScreenSize | undefined;
	private readonly adaptation = new ScreenAdaptation();
	private readonly sampler = new ScreenStatsSampler();
	private generation = 0;
	private lastError: string | undefined;

	constructor(
		private readonly sender: RTCRtpSender,
		private readonly logger: RemoteDesktopLogger,
	) {
		if (sender.track) sender.track.contentHint = "detail";
	}

	close(): void {
		this.closed = true;
		this.generation++;
		this.sender.track?.stop();
	}

	replace(track: MediaStreamTrack | null): Promise<void> {
		return this.enqueue(async () => {
			if (this.closed) {
				track?.stop();
				return;
			}
			const previous = this.sender.track;
			if (track) track.contentHint = "detail";
			try {
				await this.sender.replaceTrack(track);
			} catch (error) {
				if (track !== previous) track?.stop();
				throw error;
			}
			if (previous !== track) previous?.stop();
			this.generation++;
			this.sampler.reset();
			this.adaptation.reset();
			if (this.closed) {
				track?.stop();
				return;
			}
			await this.apply();
		});
	}

	view(shown: ScreenSize): Promise<void> {
		this.shown = shown;
		return this.update();
	}

	noteEncoder(encoder: string): Promise<void> {
		this.setEncoder(encoder);
		return this.update();
	}

	async sample(getStats: () => Promise<RTCStatsReport>): Promise<ScreenStreamSample | undefined> {
		if (this.closed || !this.sender.track) return undefined;
		const generation = this.generation;
		const stats = await getStats();
		if (this.closed || generation !== this.generation || !this.sender.track) return undefined;
		const sample = this.sampler.read(stats);
		if (!sample) return undefined;
		if (sample.encoder) this.setEncoder(sample.encoder);
		this.adaptation.observe(sample, this.capture(), this.software, this.shown);
		await this.update();
		return this.closed || generation !== this.generation ? undefined : sample;
	}

	update(): Promise<void> {
		return this.enqueue(() => this.apply());
	}

	private setEncoder(encoder: string): void {
		if (this.closed || encoder === this.encoder) return;
		this.logger.info("remote desktop encoder changed", {
			previous: this.encoder,
			encoder,
			software: isSoftwareEncoder(encoder),
		});
		this.encoder = encoder;
		this.software = isSoftwareEncoder(encoder);
	}

	private capture(): ScreenSize | undefined {
		const settings = this.sender.track?.getSettings?.();
		return settings?.width && settings.height ? { width: settings.width, height: settings.height } : undefined;
	}

	private enqueue(operation: () => Promise<void>): Promise<void> {
		const result = this.queue.then(operation);
		this.queue = result.catch(() => undefined);
		return result;
	}

	private async apply(): Promise<void> {
		if (this.closed || !this.sender.track || typeof this.sender.getParameters !== "function") return;
		const capture = this.capture();
		const scale = evenScreenScale(capture, this.adaptation.scale(capture, this.software, this.shown));
		try {
			const parameters = this.sender.getParameters();
			if (!parameters.encodings?.length) return; // Negotiation has not allocated encodings yet.
			if (
				parameters.degradationPreference === "maintain-framerate" &&
				parameters.encodings.every(
					(encoding) =>
						encoding.maxBitrate === SCREEN_MAX_BITRATE &&
						encoding.maxFramerate === SCREEN_TARGET_FPS &&
						encoding.scaleResolutionDownBy === scale,
				)
			)
				return;
			// Chromium 132 maps balanced + screenshare to maintain-resolution, permanently sacrificing motion.
			parameters.degradationPreference = "maintain-framerate";
			for (const encoding of parameters.encodings) {
				encoding.maxBitrate = SCREEN_MAX_BITRATE;
				encoding.maxFramerate = SCREEN_TARGET_FPS;
				encoding.scaleResolutionDownBy = scale;
			}
			await this.sender.setParameters(parameters);
			this.lastError = undefined;
			this.logger.info("remote desktop video parameters", {
				scale,
				maxFramerate: SCREEN_TARGET_FPS,
				software: this.software,
			});
		} catch (error) {
			// Some hosts reject parameters. Retry with a fresh transaction on the next sample.
			const name = error instanceof Error ? error.name : "unknown";
			if (this.lastError !== name)
				this.logger.warn("remote desktop video parameters rejected", { scale, error: name });
			this.lastError = name;
		}
	}
}
