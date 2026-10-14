import { describe, expect, it } from "vitest";
import { ScreenStatsSampler } from "../src/screen-stats.js";

function stats(timestamp: number, frames: number, extra: Record<string, unknown> = {}): RTCStatsReport {
	return new Map([
		[
			"video",
			{
				id: "video",
				type: "outbound-rtp",
				kind: "video",
				timestamp,
				framesEncoded: frames,
				framesSent: frames,
				totalEncodeTime: frames * 0.01,
				packetsSent: frames * 10,
				totalPacketSendDelay: frames * 0.02,
				bytesSent: frames * 1000,
				qpSum: frames * 25,
				mediaSourceId: "source",
				transportId: "transport",
				codecId: "codec",
				...extra,
			},
		],
		["wrong", { id: "wrong", type: "candidate-pair", nominated: true, availableOutgoingBitrate: 123 }],
		["transport", { id: "transport", selectedCandidatePairId: "pair" }],
		["pair", { id: "pair", availableOutgoingBitrate: 6_000_000, currentRoundTripTime: 0.03 }],
		["source", { id: "source", framesPerSecond: 30 }],
		["codec", { id: "codec", mimeType: "video/H264" }],
	]) as unknown as RTCStatsReport;
}

describe("screen statistics", () => {
	it("measures window rates and encoding/queue time on the selected transport", () => {
		const sampler = new ScreenStatsSampler();
		expect(sampler.read(stats(1000, 100))?.encodeMs).toBeUndefined();
		const result = sampler.read(stats(2000, 130));
		expect(result).toMatchObject({
			sourceFps: 30,
			encodedFps: 30,
			sentFps: 30,
			sentKbps: 240,
			availableKbps: 6000,
			roundTripMs: 30,
			qp: 25,
		});
		expect(result?.encodeMs).toBeCloseTo(10);
		expect(result?.packetSendDelayMs).toBeCloseTo(2);
	});

	it("does not turn resets, stream changes, absent counters or out-of-order samples into negative metrics", () => {
		const sampler = new ScreenStatsSampler();
		sampler.read(stats(1000, 100));
		expect(sampler.read(stats(999, 200))).toBeUndefined();
		expect(sampler.read(stats(2000, 1))?.encodeMs).toBeUndefined();
		expect(sampler.read(stats(3000, 100, { id: "replacement" }))?.encodedFps).toBeUndefined();
		sampler.reset();
		expect(sampler.read(stats(4000, 400))?.sentKbps).toBeUndefined();
	});
});
