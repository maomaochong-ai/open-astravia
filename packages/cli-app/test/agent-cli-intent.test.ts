import { describe, expect, it } from "vitest";
import { classifyAgentCliIntent } from "../src/agent-cli-intent.js";

describe("Agent CLI intent", () => {
	it.each([
		["help", ["--help"]],
		["short help", ["-h"]],
		["version", ["--version"]],
		["model listing", ["--list-models"]],
		["session export", ["--export", "session.jsonl"]],
		["package install", ["install", "example-package"]],
		["package removal", ["remove", "example-package"]],
		["package update", ["update"]],
		["package listing", ["list"]],
	])("classifies %s as control", (_name, args) => {
		expect(classifyAgentCliIntent(args)).toBe("control");
	});

	it.each([["--mode", "rpc"], ["--mode=rpc"]])("classifies RPC arguments", (...args) => {
		expect(classifyAgentCliIntent(args)).toBe("rpc");
	});

	it.each([
		["explicit print", ["--print", "hello"]],
		["text mode", ["--mode", "text", "hello"]],
		["JSON mode", ["--mode=json", "hello"]],
		["implicit input", []],
	])("keeps %s print-compatible", (_name, args) => {
		expect(classifyAgentCliIntent(args)).toBe("print");
	});
});
