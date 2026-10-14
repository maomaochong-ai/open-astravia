/** Counts and timings only; never retain SDP, candidate addresses or screen content. */
export interface ScreenStreamSample {
	readonly timestamp: number;
	readonly codec?: string;
	readonly encoder?: string;
	readonly sourceFps?: number;
	readonly encodedFps?: number;
	readonly sentFps?: number;
	readonly width?: number;
	readonly height?: number;
	readonly limitedBy?: string;
	readonly encodeMs?: number;
	readonly packetSendDelayMs?: number;
	readonly sentKbps?: number;
	readonly targetKbps?: number;
	readonly availableKbps?: number;
	readonly roundTripMs?: number;
	readonly framesEncoded?: number;
	readonly framesSent?: number;
	readonly keyFrames?: number;
	readonly pli?: number;
	readonly nack?: number;
	readonly qp?: number;
	readonly limitationDurations?: Readonly<Record<string, number>>;
}

type Report = Readonly<Record<string, unknown>>;

function number(report: Report | undefined, key: string): number | undefined {
	const value = report?.[key];
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function text(report: Report | undefined, key: string): string | undefined {
	const value = report?.[key];
	return typeof value === "string" ? value : undefined;
}

/** One video sender. Replacements and counter resets establish a new baseline. */
export class ScreenStatsSampler {
	private previous: Report | undefined;

	reset(): void {
		this.previous = undefined;
	}

	read(stats: RTCStatsReport): ScreenStreamSample | undefined {
		const reports = new Map<string, Report>();
		stats.forEach((entry: Report) => {
			reports.set(String(entry.id), entry);
		});
		const video = [...reports.values()].find((entry) => entry.type === "outbound-rtp" && entry.kind === "video");
		if (!video) return undefined;
		const timestamp = number(video, "timestamp");
		if (timestamp === undefined) return undefined;
		const prior = this.previous;
		if (prior?.id === video.id && timestamp <= (number(prior, "timestamp") ?? 0)) return undefined;
		const previous = prior?.id === video.id ? prior : undefined;
		this.previous = video;
		const elapsed = previous ? (timestamp - (number(previous, "timestamp") ?? timestamp)) / 1000 : 0;
		const delta = (key: string): number | undefined => {
			const now = number(video, key);
			const before = number(previous, key);
			return now !== undefined && before !== undefined && now >= before ? now - before : undefined;
		};
		const rate = (key: string): number | undefined => {
			const value = delta(key);
			return elapsed > 0 && value !== undefined ? value / elapsed : undefined;
		};
		const per = (total: string, count: string, factor = 1): number | undefined => {
			const amount = delta(total);
			const items = delta(count);
			return amount !== undefined && items !== undefined && items > 0 ? (amount / items) * factor : undefined;
		};
		const transport = reports.get(text(video, "transportId") ?? "");
		const pair = reports.get(text(transport, "selectedCandidatePairId") ?? "");
		const source = reports.get(text(video, "mediaSourceId") ?? "");
		const durations: Record<string, number> = {};
		const rawDurations = video.qualityLimitationDurations;
		if (rawDurations && typeof rawDurations === "object") {
			for (const [key, value] of Object.entries(rawDurations)) {
				if (["none", "cpu", "bandwidth", "other"].includes(key) && typeof value === "number" && value >= 0)
					durations[key] = value;
			}
		}
		return {
			timestamp,
			codec: text(reports.get(text(video, "codecId") ?? ""), "mimeType"),
			encoder: text(video, "encoderImplementation"),
			sourceFps: number(source, "framesPerSecond"),
			encodedFps: rate("framesEncoded") ?? number(video, "framesPerSecond"),
			sentFps: rate("framesSent"),
			width: number(video, "frameWidth"),
			height: number(video, "frameHeight"),
			limitedBy: text(video, "qualityLimitationReason"),
			encodeMs: per("totalEncodeTime", "framesEncoded", 1000),
			packetSendDelayMs: per("totalPacketSendDelay", "packetsSent", 1000),
			sentKbps: scale(rate("bytesSent"), 8 / 1000),
			targetKbps: scale(number(video, "targetBitrate"), 1 / 1000),
			availableKbps: scale(number(pair, "availableOutgoingBitrate"), 1 / 1000),
			roundTripMs: scale(number(pair, "currentRoundTripTime"), 1000),
			framesEncoded: number(video, "framesEncoded"),
			framesSent: number(video, "framesSent"),
			keyFrames: number(video, "keyFramesEncoded"),
			pli: number(video, "pliCount"),
			nack: number(video, "nackCount"),
			qp: per("qpSum", "framesEncoded"),
			limitationDurations: durations,
		};
	}
}

function scale(value: number | undefined, factor: number): number | undefined {
	return value === undefined ? undefined : value * factor;
}
