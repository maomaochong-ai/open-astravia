import { describe, expect, it } from "vitest";
import {
	createMcpMediaAdmission,
	inspectMcpMediaCandidate,
	selectMcpMediaCandidates,
} from "../src/tools/mcp-media-policy.js";

describe("MCP media projection policy", () => {
	it("accepts canonical bounded media and rejects executable or malformed payloads", () => {
		expect(inspectMcpMediaCandidate({ type: "image", data: "aW1hZ2U=", mimeType: "image/png" })).toBe(5);
		expect(inspectMcpMediaCandidate({ type: "audio", data: "YXVkaW8=", mimeType: "audio/mpeg" })).toBe(5);
		expect(
			inspectMcpMediaCandidate({ type: "image", data: "PHN2Zz48c2NyaXB0Lz48L3N2Zz4=", mimeType: "image/svg+xml" }),
		).toBeUndefined();
		expect(inspectMcpMediaCandidate({ type: "audio", data: "not base64", mimeType: "audio/mpeg" })).toBeUndefined();
	});

	it("enforces item count, per-item bytes and aggregate bytes with one shared budget", () => {
		const candidates = [
			{ type: "image" as const, data: "YQ==", mimeType: "image/png", id: 1 },
			{ type: "image" as const, data: "YmI=", mimeType: "image/jpeg", id: 2 },
			{ type: "audio" as const, data: "Yw==", mimeType: "audio/ogg", id: 3 },
		];
		expect(selectMcpMediaCandidates(candidates, { maxItems: 2, maxItemBytes: 2, maxTotalBytes: 3 })).toEqual(
			candidates.slice(0, 2),
		);

		const admission = createMcpMediaAdmission({ maxItems: 4, maxItemBytes: 1, maxTotalBytes: 4 });
		expect(admission.accept(candidates[0])).toBe(true);
		expect(admission.accept(candidates[1])).toBe(false);
	});
});
