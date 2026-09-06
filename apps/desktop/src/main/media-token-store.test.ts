import { describe, expect, it, vi } from "vitest";
import { createEphemeralMediaToken, resolveEphemeralMediaToken } from "./media-token-store.js";

describe("ephemeral media tokens", () => {
	it("does not expose paths and expires", () => {
		vi.useFakeTimers();
		const token = createEphemeralMediaToken("C:\\private\\page.png", "image/png", 1000);
		expect(token).not.toContain("private");
		expect(resolveEphemeralMediaToken(token)).toMatchObject({ path: "C:\\private\\page.png", mimeType: "image/png" });
		vi.advanceTimersByTime(1001);
		expect(resolveEphemeralMediaToken(token)).toBeNull();
		vi.useRealTimers();
	});
});
