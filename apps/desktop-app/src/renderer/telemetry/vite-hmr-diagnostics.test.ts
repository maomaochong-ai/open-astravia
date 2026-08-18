import { describe, expect, it } from "vitest";
import { summarizeViteHmrPayload } from "./vite-hmr-diagnostics";

describe("Vite HMR diagnostics", () => {
	it("extracts only reload source fields", () => {
		expect(
			summarizeViteHmrPayload({
				path: "*",
				triggeredBy: "/src/router.ts",
				secret: "do not log",
			}),
		).toEqual({ path: "*", triggeredBy: "/src/router.ts" });
	});

	it("summarizes module updates without retaining arbitrary payload data", () => {
		expect(
			summarizeViteHmrPayload({
				updates: [
					{
						type: "js-update",
						path: "/src/App.tsx",
						acceptedPath: "/src/App.tsx",
						timestamp: 123,
					},
				],
			}),
		).toEqual({
			updates: [{ type: "js-update", path: "/src/App.tsx", acceptedPath: "/src/App.tsx" }],
		});
	});
});
