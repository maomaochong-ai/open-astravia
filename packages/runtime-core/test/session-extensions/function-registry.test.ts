import { describe, expect, it, vi } from "vitest";
import {
	defineSessionExtensionFunction,
	SessionExtensionFunctionRegistry,
	SessionExtensionFunctionUnavailableError,
} from "../../src/index.js";

const FORMAT_VALUE = defineSessionExtensionFunction<{ readonly value: number }, string>("formatter", "format");

describe("SessionExtensionFunctionRegistry", () => {
	it("registers and invokes typed functions", async () => {
		const registry = new SessionExtensionFunctionRegistry();
		registry.register(FORMAT_VALUE, ({ value }) => `value:${value}`);

		expect(registry.has(FORMAT_VALUE)).toBe(true);
		await expect(registry.invoke(FORMAT_VALUE, { value: 42 })).resolves.toBe("value:42");
	});

	it("rejects duplicate registrations and only removes the captured binding", async () => {
		const registry = new SessionExtensionFunctionRegistry();
		const unregister = registry.register(FORMAT_VALUE, ({ value }) => `first:${value}`);

		expect(() => registry.register(FORMAT_VALUE, ({ value }) => `second:${value}`)).toThrow("already registered");
		unregister();
		unregister();
		expect(registry.has(FORMAT_VALUE)).toBe(false);
		await expect(registry.invoke(FORMAT_VALUE, { value: 1 })).rejects.toBeInstanceOf(
			SessionExtensionFunctionUnavailableError,
		);
	});

	it("lets in-flight calls finish after unregistering while rejecting later calls", async () => {
		const registry = new SessionExtensionFunctionRegistry();
		let finish: ((value: string) => void) | undefined;
		const unregister = registry.register(
			FORMAT_VALUE,
			() =>
				new Promise<string>((resolve) => {
					finish = resolve;
				}),
		);

		const inFlight = registry.invoke(FORMAT_VALUE, { value: 1 });
		unregister();
		await expect(registry.invoke(FORMAT_VALUE, { value: 2 })).rejects.toBeInstanceOf(
			SessionExtensionFunctionUnavailableError,
		);
		finish?.("completed");
		await expect(inFlight).resolves.toBe("completed");
	});

	it("propagates cancellation without calling the handler", async () => {
		const registry = new SessionExtensionFunctionRegistry();
		const handler = vi.fn(() => "unexpected");
		registry.register(FORMAT_VALUE, handler);
		const controller = new AbortController();
		controller.abort();

		await expect(registry.invoke(FORMAT_VALUE, { value: 1 }, controller.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(handler).not.toHaveBeenCalled();
	});

	it("closes idempotently and rejects later registration or invocation", async () => {
		const registry = new SessionExtensionFunctionRegistry();
		registry.register(FORMAT_VALUE, ({ value }) => String(value));

		registry.close();
		registry.close();

		expect(registry.has(FORMAT_VALUE)).toBe(false);
		expect(() => registry.register(FORMAT_VALUE, ({ value }) => String(value))).toThrow("registry is closed");
		await expect(registry.invoke(FORMAT_VALUE, { value: 1 })).rejects.toThrow("registry is closed");
	});
});
