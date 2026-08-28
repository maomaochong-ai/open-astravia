import { describe, expect, it } from "vitest";
import { resolveDesktopSessionOpenTarget } from "./session-access.js";

describe("desktop session access policy", () => {
	it("selects an interactive page only when the host supports interactive resume", () => {
		expect(
			resolveDesktopSessionOpenTarget({
				readHistory: true,
				resume: true,
				rename: true,
				delete: true,
			}),
		).toBe("interactive");
	});

	it("selects the viewer for history-only sessions and rejects unsupported sessions", () => {
		expect(
			resolveDesktopSessionOpenTarget({
				readHistory: true,
				resume: false,
				rename: true,
				delete: true,
			}),
		).toBe("viewer");
		expect(
			resolveDesktopSessionOpenTarget({
				readHistory: false,
				resume: false,
				rename: false,
				delete: false,
			}),
		).toBe("unavailable");
	});
});
