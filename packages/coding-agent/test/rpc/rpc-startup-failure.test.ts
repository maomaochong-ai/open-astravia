import { describe, expect, it } from "vitest";
import {
	isRpcStartupFailure,
	type RpcStartupFailure,
	stringifyRpcStartupFailure,
} from "../../src/modes/rpc/rpc-startup-failure.js";

describe("RPC startup failure contract", () => {
	it("accepts the existing ownership conflict wire", () => {
		expect(
			isRpcStartupFailure({
				type: "response",
				command: "startup",
				success: false,
				error: "Conversation is already owned",
				lockHolder: { pid: 123, hostname: "test-host", openedAt: "2026-08-02T00:00:00.000Z" },
			}),
		).toBe(true);
	});

	it("serializes an Extension incompatibility as one JSONL frame", () => {
		const failure = {
			type: "response",
			command: "startup",
			success: false,
			errorCode: "extension_incompatible",
			error: "Extension is incompatible",
			unsupportedEvents: ["future_event"],
			unmetRuntimeCapabilities: ["event-handler"],
		} as const satisfies RpcStartupFailure;

		expect(stringifyRpcStartupFailure(failure)).toBe(`${JSON.stringify(failure)}\n`);
	});

	it("rejects incomplete Extension incompatibility frames at runtime", () => {
		const incomplete = {
			type: "response",
			command: "startup",
			success: false,
			errorCode: "extension_incompatible",
			error: "Extension is incompatible",
		};

		expect(isRpcStartupFailure(incomplete)).toBe(false);
		expect(() => stringifyRpcStartupFailure(incomplete as unknown as RpcStartupFailure)).toThrow(
			"Invalid RPC startup failure frame",
		);
	});

	it("serializes a content-free Session incompatibility as one JSONL frame", () => {
		const failure = {
			type: "response",
			command: "startup",
			success: false,
			errorCode: "session_version_unsupported",
			error: "Historical session cannot be imported safely",
			sessionPath: "C:/sessions/future.jsonl",
			sourceVersion: 4,
			issueCode: "invalid-header",
			issueCount: 1,
		} as const satisfies RpcStartupFailure;

		expect(stringifyRpcStartupFailure(failure)).toBe(`${JSON.stringify(failure)}\n`);
	});
});
