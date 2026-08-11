import { describe, expect, it } from "vitest";
import { findAgentAiMaintainabilityViolations } from "./check-agent-ai-maintainability.mjs";

const facadePaths = [
	"packages/ai/src/providers/amazon-bedrock.ts",
	"packages/ai/src/providers/anthropic.ts",
	"packages/ai/src/providers/google-gemini-cli.ts",
	"packages/ai/src/providers/openai-codex-responses.ts",
	"packages/ai/src/providers/openai-completions.ts",
	"packages/ai/src/providers/openai-responses-shared.ts",
];

const ownerPaths = [
	"packages/agent/src/loop/assistant-stream.ts",
	"packages/agent/src/loop/context-checkpoint.ts",
	"packages/agent/src/loop/telemetry.ts",
	"packages/agent/src/loop/tool-execution.ts",
	"packages/agent/src/runtime/message-queue.ts",
	"packages/agent/src/runtime/state-projection.ts",
	"packages/ai/src/providers/amazon-bedrock/client.ts",
	"packages/ai/src/providers/amazon-bedrock/events.ts",
	"packages/ai/src/providers/amazon-bedrock/messages.ts",
	"packages/ai/src/providers/amazon-bedrock/request.ts",
	"packages/ai/src/providers/amazon-bedrock/stream.ts",
	"packages/ai/src/providers/anthropic/client.ts",
	"packages/ai/src/providers/anthropic/messages.ts",
	"packages/ai/src/providers/anthropic/request.ts",
	"packages/ai/src/providers/anthropic/stream.ts",
	"packages/ai/src/providers/google-gemini-cli/request.ts",
	"packages/ai/src/providers/google-gemini-cli/response.ts",
	"packages/ai/src/providers/google-gemini-cli/retry.ts",
	"packages/ai/src/providers/google-gemini-cli/stream.ts",
	"packages/ai/src/providers/openai-codex/events.ts",
	"packages/ai/src/providers/openai-codex/request.ts",
	"packages/ai/src/providers/openai-codex/stream.ts",
	"packages/ai/src/providers/openai-codex/websocket.ts",
	"packages/ai/src/providers/openai-completions/messages.ts",
	"packages/ai/src/providers/openai-completions/request.ts",
	"packages/ai/src/providers/openai-completions/stream.ts",
	"packages/ai/src/providers/openai-responses/events.ts",
	"packages/ai/src/providers/openai-responses/messages.ts",
];

function validFiles() {
	return [
		...facadePaths.map((path) => ({ path, text: 'export { value } from "./internal.js";' })),
		...ownerPaths.map((path) => ({ path, text: "export {};" })),
		{
			path: "packages/agent/src/agent-loop.ts",
			text: [
				'import "./loop/assistant-stream.js";',
				'import "./loop/context-checkpoint.js";',
				'import "./loop/telemetry.js";',
				'import "./loop/tool-execution.js";',
			].join("\n"),
		},
	];
}

describe("Agent and AI maintainability guard", () => {
	it("accepts responsibility owners and export-only facades", () => {
		expect(findAgentAiMaintainabilityViolations(validFiles())).toEqual([]);
	});

	it("rejects implementation statements in provider facades", () => {
		const files = validFiles();
		files.find(({ path }) => path === facadePaths[0]).text = "export const value = 1;";

		expect(findAgentAiMaintainabilityViolations(files)).toContain(
			`${facadePaths[0]}: provider facade may only contain export declarations`,
		);
	});

	it("rejects missing owners and inline import types", () => {
		const files = validFiles().filter(({ path }) => path !== ownerPaths[0]);
		files.push({ path: "packages/ai/src/example.ts", text: 'let value: typeof import("node:fs");' });
		const violations = findAgentAiMaintainabilityViolations(files);

		expect(violations).toContain(`${ownerPaths[0]}: required responsibility owner is missing`);
		expect(violations).toContain(
			"packages/ai/src/example.ts: inline import type is forbidden; use a top-level import type",
		);
	});
});
