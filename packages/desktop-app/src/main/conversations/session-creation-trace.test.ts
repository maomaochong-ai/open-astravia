import { describe, expect, it, vi } from "vitest";
import { DesktopSessionCreationTrace } from "./session-creation-trace.js";

describe("DesktopSessionCreationTrace", () => {
	it("emits one correlated summary with per-stage durations", async () => {
		let currentTime = 0;
		const logger = { info: vi.fn(), warn: vi.fn() };
		const trace = new DesktopSessionCreationTrace(logger, "trace-1", () => currentTime);

		await trace.measure("sandbox-check", async () => {
			currentTime = 2;
		});
		await trace.measure("runtime-create", async () => {
			currentTime = 42.16;
		});
		currentTime = 45;
		trace.complete({ sessionId: "session-1", kind: "conversation", source: "interactive" });
		trace.complete({ sessionId: "session-1", kind: "conversation", source: "interactive" });

		expect(logger.info).toHaveBeenCalledOnce();
		expect(logger.info).toHaveBeenCalledWith("session creation trace", {
			interactionId: "trace-1",
			status: "completed",
			totalDurationMs: 45,
			stages: { "sandbox-check": 2, "runtime-create": 40.2 },
			sessionId: "session-1",
			kind: "conversation",
			source: "interactive",
		});
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("preserves the original failure when diagnostics fail", async () => {
		const logger = {
			info: vi.fn(),
			warn: vi.fn(() => {
				throw new Error("logger failed");
			}),
		};
		const trace = new DesktopSessionCreationTrace(logger, "trace-2", () => 1);

		await expect(
			trace.measure("resolve-config", async () => {
				throw new Error("config failed");
			}),
		).rejects.toThrow("config failed");
		expect(() => trace.fail({ kind: "other", source: "interactive" })).not.toThrow();
	});
});
