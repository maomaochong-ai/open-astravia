import { describe, expect, it } from "vitest";
import { DesktopRuntimeLifecycle } from "./desktop-runtime-lifecycle.js";

describe("DesktopRuntimeLifecycle", () => {
	it("allows one runtime to become active before shutdown", () => {
		const lifecycle = new DesktopRuntimeLifecycle();

		lifecycle.assertCanAccessRuntime();
		lifecycle.markRunning();

		expect(lifecycle.state).toBe("running");
		lifecycle.assertCanAccessRuntime();
	});

	it("fails closed as soon as shutdown begins", () => {
		const lifecycle = new DesktopRuntimeLifecycle();
		lifecycle.markRunning();

		lifecycle.beginShutdown();
		lifecycle.beginShutdown();

		expect(lifecycle.state).toBe("stopping");
		expect(() => lifecycle.assertCanAccessRuntime()).toThrowError("Desktop RuntimeHost is stopping");

		lifecycle.markStopped();
		lifecycle.beginShutdown();

		expect(lifecycle.state).toBe("stopped");
		expect(() => lifecycle.assertCanAccessRuntime()).toThrowError("Desktop RuntimeHost is stopped");
	});

	it("records typed process-level failures and clears them after a successful start", () => {
		const lifecycle = new DesktopRuntimeLifecycle();

		lifecycle.recordFailure({
			errorCode: "runtime_startup_failed",
			phase: "startup",
			recoverability: "retry_safe",
			message: "model bootstrap failed",
		});

		expect(lifecycle.snapshot()).toMatchObject({
			state: "idle",
			lastFailure: {
				errorCode: "runtime_startup_failed",
				phase: "startup",
				recoverability: "retry_safe",
				message: "model bootstrap failed",
				occurredAt: expect.any(String),
			},
		});

		lifecycle.markRunning();

		expect(lifecycle.snapshot()).toEqual({ state: "running" });
	});
});
