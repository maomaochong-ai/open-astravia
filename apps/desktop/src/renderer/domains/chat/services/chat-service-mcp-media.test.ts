import { describe, expect, it } from "vitest";
import { extractToolAudioPreviews, extractToolImagePreviews } from "./chat-service";

describe("MCP Desktop media projection", () => {
	it("renders safe media and drops malformed or executable data URLs", () => {
		expect(
			extractToolImagePreviews(
				[
					{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
					{ type: "image", data: "PHN2Zz4=", mimeType: "image/svg+xml" },
				],
				undefined,
			),
		).toEqual([
			{
				data: "aW1hZ2U=",
				mimeType: "image/png",
				processedSizeBytes: 5,
			},
		]);
		expect(
			extractToolAudioPreviews([], {
				media: [
					{ type: "audio", data: "YXVkaW8=", mimeType: "audio/mpeg" },
					{ type: "audio", data: "not base64", mimeType: "audio/mpeg" },
				],
			}),
		).toEqual([{ data: "YXVkaW8=", mimeType: "audio/mpeg" }]);
	});
});
