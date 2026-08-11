import { describe, expect, it } from "vitest";
import { resolveDesktopSessionOpenTarget } from "./session-access.js";

describe("desktop session access policy", () => {
	it("selects an interactive page only when the host supports interactive resume", () => {
		expect(
			resolveDesktopSessionOpenTarget({
				readHistory: true,
				interactiveResume: true,
				rename: true,
				delete: true,
			}),
		).toBe("interactive");
	});

	it("selects the viewer for history-only sessions and rejects unsupported sessions", () => {
		expect(
			resolveDesktopSessionOpenTarget({
				readHistory: true,
				interactiveResume: false,
				rename: true,
				delete: true,
			}),
		).toBe("viewer");
		expect(
			resolveDesktopSessionOpenTarget({
				readHistory: false,
				interactiveResume: false,
				rename: false,
				delete: false,
			}),
		).toBe("unavailable");
	});
});
