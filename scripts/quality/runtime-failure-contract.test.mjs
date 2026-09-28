import { describe, expect, it } from "vitest";
import { findRuntimeFailureContractViolations } from "./check-runtime-failure-contract.mjs";

describe("runtime failure contract gate", () => {
	it("accepts structured recovery decisions", () => {
		expect(
			findRuntimeFailureContractViolations([
				{ path: "packages/coding-agent/src/rpc/example.ts", text: 'return { recoverability: "user_action" };' },
			]),
		).toEqual([]);
	});

	it("rejects message-based recovery classification and automatic replay", () => {
		const files = [
			{
				path: "packages/coding-agent/src/rpc/example.ts",
				text: 'if (error.message.includes("timeout")) return "automatic_replay";',
			},
		];

		expect(findRuntimeFailureContractViolations(files)).toEqual([
			"packages/coding-agent/src/rpc/example.ts: classifies recovery by JavaScript error message",
			"packages/coding-agent/src/rpc/example.ts: reintroduces automatic Turn replay",
		]);
	});

	it("can inspect isolated forbidden-pattern fixtures", () => {
		const files = [
			{
				path: "apps/im-gateway/internal/hostclient/example.go",
				text: 'strings.Contains(err.Error(), "timeout")',
			},
			{
				path: "apps/desktop/src/main/conversations/example.ts",
				text: 'if (error.name === "SessionLockError") return "locked";',
			},
		];

		expect(findRuntimeFailureContractViolations(files)).toEqual([
			"apps/im-gateway/internal/hostclient/example.go: classifies recovery by Go error message",
			"apps/desktop/src/main/conversations/example.ts: classifies recovery by JavaScript error name",
		]);
	});
});
