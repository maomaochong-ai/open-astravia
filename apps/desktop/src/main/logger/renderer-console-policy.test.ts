import { describe, expect, it } from "vitest";
import { shouldPersistRendererConsoleMessage } from "./renderer-console-policy.js";

describe("shouldPersistRendererConsoleMessage", () => {
	it("filters low-signal development diagnostics at info level", () => {
		expect(shouldPersistRendererConsoleMessage("info", "[plugin-agent] load start", false)).toBe(false);
		expect(shouldPersistRendererConsoleMessage("info", "[activity-tab-debug] resolved {}", false)).toBe(false);
		expect(shouldPersistRendererConsoleMessage("info", "[vite] hot updated: /App.tsx", false)).toBe(false);
		expect(shouldPersistRendererConsoleMessage("info", '[theme-runtime] module load start "dark"', false)).toBe(
			false,
		);
	});

	it("keeps the semantic theme selection chain", () => {
		expect(shouldPersistRendererConsoleMessage("info", '[theme-runtime] selectTheme "dark"', false)).toBe(true);
		expect(
			shouldPersistRendererConsoleMessage("info", '[theme-runtime] theme "dark" ready elapsed=10ms', false),
		).toBe(true);
		expect(shouldPersistRendererConsoleMessage("info", "[activity-tab] opened {}", false)).toBe(true);
	});

	it("keeps warnings and errors even when they use a debug prefix", () => {
		expect(shouldPersistRendererConsoleMessage("warn", "[theme-runtime] fallback", false)).toBe(true);
		expect(shouldPersistRendererConsoleMessage("error", "[plugin-agent] failed", false)).toBe(true);
	});

	it("allows an explicit verbose override", () => {
		expect(shouldPersistRendererConsoleMessage("info", "[plugin-agent] load start", true)).toBe(true);
	});
});
