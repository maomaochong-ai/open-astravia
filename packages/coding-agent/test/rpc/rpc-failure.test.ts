import { describe, expect, it } from "vitest";
import { isRpcFailureMetadata, RPC_FAILURE_CODES } from "../../src/modes/rpc/rpc-failure.js";

describe("RPC failure metadata", () => {
	it("accepts the stable external failure dimensions", () => {
		expect(
			isRpcFailureMetadata({
				errorCode: RPC_FAILURE_CODES.REQUEST_TIMEOUT,
				phase: "turn",
				recoverability: "continue_session",
			}),
		).toBe(true);
	});

	it("rejects missing or unknown recovery semantics", () => {
		expect(isRpcFailureMetadata({ errorCode: "command_failed", phase: "turn" })).toBe(false);
		expect(
			isRpcFailureMetadata({
				errorCode: "command_failed",
				phase: "turn",
				recoverability: "automatic_replay",
			}),
		).toBe(false);
	});
});
