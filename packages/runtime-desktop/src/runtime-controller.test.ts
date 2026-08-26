import type { RuntimeHost } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { DesktopRuntimeController } from "./runtime-controller.js";

describe("DesktopRuntimeController", () => {
	it("creates one process Runtime and returns it to every consumer", () => {
		const runtime = runtimeWithDispose(vi.fn(async () => {}));
		const createComposition = vi.fn(() => ({
			runtime,
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

	it("closes the single RuntimeHost and makes shutdown idempotent", async () => {
		const order: string[] = [];
		const close = vi.fn(async () => {
			order.push("runtime-host");
		});
		const controller = new DesktopRuntimeController(() => ({
			runtime: runtimeWithDispose(close),
		}));
		controller.get();

		await Promise.all([controller.dispose(), controller.dispose()]);

		expect(order).toEqual(["runtime-host"]);
		expect(close).toHaveBeenCalledTimes(1);
		expect(controller.peek()).toBeNull();
		expect(controller.health()).toEqual({ state: "stopped" });
		expect(() => controller.get()).toThrowError("Desktop RuntimeHost is stopped");
	});

	it("records failure when RuntimeHost shutdown fails", async () => {
		const controller = new DesktopRuntimeController(() => ({
			runtime: runtimeWithDispose(vi.fn(async () => Promise.reject(new Error("session close failed")))),
		}));
		controller.get();

		await expect(controller.dispose()).rejects.toThrowError("session close failed");
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

function runtimeWithDispose(close: () => Promise<void>): RuntimeHost {
	return { close } as RuntimeHost;
}
