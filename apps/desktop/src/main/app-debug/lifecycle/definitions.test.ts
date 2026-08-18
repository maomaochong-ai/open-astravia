import { afterEach, describe, expect, it, vi } from "vitest";
import { createLifecycleDebugDefinitions } from "./definitions.js";

describe("lifecycle Debug definitions", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns the RPC result before requesting Electron shutdown", async () => {
		vi.useFakeTimers();
		const requestQuit = vi.fn();
		const [definition] = createLifecycleDebugDefinitions(requestQuit);
		if (!definition) throw new Error("Expected lifecycle.quit definition");

		const result = await definition.run(definition.validateInput({}), {
			source: "local-server",
		});

		expect(result).toEqual({ status: "scheduled", delayMs: 75 });
		expect(requestQuit).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(75);
		expect(requestQuit).toHaveBeenCalledOnce();
	});

	it("rejects non-empty input", () => {
		const [definition] = createLifecycleDebugDefinitions(() => undefined);
		if (!definition) throw new Error("Expected lifecycle.quit definition");

		expect(() => definition.validateInput({ force: true })).toThrow("lifecycle.quit input must be an empty object");
	});
});
