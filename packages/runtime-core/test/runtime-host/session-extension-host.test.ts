import { describe, expect, it, vi } from "vitest";
import { createRuntimeSessionExtensionHost } from "../../src/runtime-host/index.js";
import type {
	SessionExtensionEndpointHost,
	SessionExtensionEndpointToken,
} from "../../src/session-extensions/index.js";
import {
	defineSessionExtensionEndpoint,
	defineSessionExtensionObservation,
	sessionExtensionObservation,
} from "../../src/session-extensions/index.js";

describe("createRuntimeSessionExtensionHost", () => {
	it("projects generic endpoints and initial observations into the host contract", async () => {
		const endpoint = defineSessionExtensionEndpoint<number, number>("example", "double");
		const observed = defineSessionExtensionObservation<{ value: number }>("example", "state");
		const invoke = vi.fn();
		const endpoints: SessionExtensionEndpointHost = {
			hasEndpoint: () => true,
			invoke: async <Input, Output>(_token: SessionExtensionEndpointToken<Input, Output>, input: Input) => {
				invoke(input);
				return (Number(input) * 2) as unknown as Output;
			},
			invokeSync: <Input, Output>(_token: SessionExtensionEndpointToken<Input, Output>, input: Input) =>
				(Number(input) * 2) as unknown as Output,
		};
		const host = createRuntimeSessionExtensionHost({
			endpoints,
			readInitialObservations: () => [sessionExtensionObservation(observed, { value: 3 })],
		});

		expect(host.hasEndpoint(endpoint)).toBe(true);
		await expect(host.invoke(endpoint, 4)).resolves.toBe(8);
		expect(host.invokeSync(endpoint, 5)).toBe(10);
		expect(host.readInitialObservations()).toEqual([
			{
				type: "session.extension",
				extensionId: "example",
				event: "state",
				payload: { value: 3 },
				source: "extension",
			},
		]);
	});
});
