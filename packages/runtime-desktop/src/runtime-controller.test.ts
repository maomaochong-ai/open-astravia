import type { RuntimeHost } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { DesktopRuntimeController } from "./runtime-controller.js";

describe("DesktopRuntimeController", () => {
	it("creates one process Runtime and returns it to every consumer", () => {
		const runtime = runtimeWithDispose(vi.fn(async () => {}));
		const createComposition = vi.fn(() => ({
			runtime,
			runtimeBackendPool: { dispose: vi.fn(async () => {}) },
		}));
		const controller = new DesktopRuntimeController(createComposition);

		expect(controller.peek()).toBeNull();
		expect(controller.get()).toBe(runtime);
		expect(controller.get()).toBe(runtime);
		expect(createComposition).toHaveBeenCalledTimes(1);
		expect(controller.health()).toEqual({ state: "running" });
	});

	it("records a retry-safe startup failure without publishing a partial Runtime", () => {
		const controller = new DesktopRuntimeController(() => {
			throw new Error("composition failed");
		});

		expect(() => controller.get()).toThrowError("composition failed");
		expect(controller.peek()).toBeNull();
		expect(controller.health()).toMatchObject({
			state: "idle",
			lastFailure: {
				errorCode: "runtime_startup_failed",
				phase: "startup",
				recoverability: "retry_safe",
				message: "composition failed",
			},
		});
	});

	it("disposes sessions before the backend pool and makes shutdown idempotent", async () => {
		const order: string[] = [];
		const disposeAllSessions = vi.fn(async () => {
			order.push("sessions");
		});
		const disposeBackendPool = vi.fn(async () => {
			order.push("backend-pool");
		});
		const controller = new DesktopRuntimeController(() => ({
			runtime: runtimeWithDispose(disposeAllSessions),
			runtimeBackendPool: { dispose: disposeBackendPool },
		}));
		controller.get();

		await Promise.all([controller.dispose(), controller.dispose()]);

		expect(order).toEqual(["sessions", "backend-pool"]);
		expect(disposeAllSessions).toHaveBeenCalledTimes(1);
		expect(disposeBackendPool).toHaveBeenCalledTimes(1);
		expect(controller.peek()).toBeNull();
		expect(controller.health()).toEqual({ state: "stopped" });
		expect(() => controller.get()).toThrowError("Desktop RuntimeHost is stopped");
	});

	it("still disposes the backend pool and records failure when session shutdown fails", async () => {
		const disposeBackendPool = vi.fn(async () => {});
		const controller = new DesktopRuntimeController(() => ({
			runtime: runtimeWithDispose(vi.fn(async () => Promise.reject(new Error("session close failed")))),
			runtimeBackendPool: { dispose: disposeBackendPool },
		}));
		controller.get();

		await expect(controller.dispose()).rejects.toThrowError("session close failed");
		expect(disposeBackendPool).toHaveBeenCalledTimes(1);
		expect(controller.health()).toMatchObject({
			state: "stopped",
			lastFailure: {
				errorCode: "runtime_shutdown_failed",
				phase: "shutdown",
				recoverability: "restart_session",
				message: "session close failed",
			},
		});
	});
});

function runtimeWithDispose(disposeAllSessions: () => Promise<void>): RuntimeHost {
	return { disposeAllSessions } as RuntimeHost;
}
