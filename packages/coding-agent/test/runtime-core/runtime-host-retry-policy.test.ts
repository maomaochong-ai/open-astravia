import type { RuntimeFailure } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import type { CodingAgentRuntimeHostRetrySettings } from "../../src/composition/contracts/index.js";
import { parseCodingAgentRuntimeSessionConfiguration } from "../../src/composition/contracts/index.js";
import { createCodingAgentRuntimeHostRetryPolicy } from "../../src/composition/runtime-host-retry.js";

const retryableFailure: RuntimeFailure = {
	code: "AI_TRANSPORT_FAILED",
	message: "Internal Server Error",
	retryable: true,
	origin: "provider",
};

describe("Coding Agent Runtime-host retry policy", () => {
	it("validates the session-level retry ownership contract", () => {
		expect(parseCodingAgentRuntimeSessionConfiguration({ automaticRetry: false })).toMatchObject({
			automaticRetry: false,
		});
		expect(() => parseCodingAgentRuntimeSessionConfiguration({ automaticRetry: "false" })).toThrow(
			"field automaticRetry must be a boolean",
		);
	});

	it("keeps automatic retries enabled by default", () => {
		const settings = createSettings();
		const policy = createCodingAgentRuntimeHostRetryPolicy(settings);
		expect(policy.decide({ failure: retryableFailure, completedRetries: 0 })).toMatchObject({ action: "retry" });
	});

	it("stops before an inner retry when an outer task scheduler owns retries", () => {
		const settings = createSettings();
		const policy = createCodingAgentRuntimeHostRetryPolicy(settings, false);
		expect(policy.decide({ failure: retryableFailure, completedRetries: 0 })).toEqual({
			action: "stop",
			reason: "disabled",
		});
		expect(settings.getRetrySettings).not.toHaveBeenCalled();
	});
});

function createSettings(): CodingAgentRuntimeHostRetrySettings {
	return {
		getRetrySettings: vi.fn(() => ({ enabled: true, maxRetries: 3, baseDelayMs: 2_000 })),
		setRetryEnabled: vi.fn(),
	};
}
