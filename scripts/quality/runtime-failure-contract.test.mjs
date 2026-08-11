import { describe, expect, it } from "vitest";
import {
	findRuntimeFailureContractViolations,
	REQUIRED_RUNTIME_FAILURE_MARKERS,
} from "./check-runtime-failure-contract.mjs";

function contractFixture() {
	return Object.entries(REQUIRED_RUNTIME_FAILURE_MARKERS).map(([path, markers]) => ({
		path,
		text: markers.join("\n"),
	}));
}

describe("runtime failure contract gate", () => {
	it("accepts structured failure boundaries with explicit recovery values", () => {
		expect(findRuntimeFailureContractViolations(contractFixture())).toEqual([]);
	});

	it("rejects missing metadata and message-based recovery classification", () => {
		const files = contractFixture();
		files[0].text = files[0].text.replace('"retry_safe"', "");
		files.push({
			path: "packages/coding-agent/src/modes/rpc/example.ts",
			text: 'if (error.message.includes("timeout")) return "automatic_replay";',
		});

		expect(findRuntimeFailureContractViolations(files)).toEqual([
			'packages/coding-agent/src/modes/rpc/rpc-failure.ts: missing contract marker ("retry_safe")',
			"packages/coding-agent/src/modes/rpc/example.ts: classifies recovery by JavaScript error message",
			"packages/coding-agent/src/modes/rpc/example.ts: reintroduces automatic Turn replay",
		]);
	});

	it("can inspect isolated forbidden-pattern fixtures", () => {
		const files = [
			{
				path: "packages/im-gateway/internal/hostclient/example.go",
				text: 'strings.Contains(err.Error(), "timeout")',
			},
			{
				path: "packages/desktop-app/src/main/conversations/example.ts",
				text: 'if (error.name === "SessionLockError") return "locked";',
			},
		];

		expect(findRuntimeFailureContractViolations(files, { requireBaseline: false })).toEqual([
			"packages/im-gateway/internal/hostclient/example.go: classifies recovery by Go error message",
			"packages/desktop-app/src/main/conversations/example.ts: classifies recovery by JavaScript error name",
		]);
	});
});
