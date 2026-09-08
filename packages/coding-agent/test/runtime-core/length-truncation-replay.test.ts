import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Message } from "@vetta/ai";
import type { ContinuationPolicyContext } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import { CodingAgentLengthContinuationSource } from "../../src/composition/turn/length-continuation-source.js";

/**
 * 真实故障回放：vetta-go / ominiroute-antigravity 网关在高思考档下，把整个输出
 * 预算烧在 thinking 上就回了 MAX_TOKENS，正文零产出。旧实现会连续注入三条
 * "Continue the response from where you stopped."，最终以 turn.failed 收场。
 */
const CAPTURE = JSON.parse(
	readFileSync(fileURLToPath(new URL("../fixtures/length-truncation-capture.json", import.meta.url)), "utf8"),
) as { readonly messages: readonly Message[] };

function continuationContext(messages: readonly Message[]): ContinuationPolicyContext {
	return {
		sessionId: "replay",
		turnId: "turn-replay",
		signal: new AbortController().signal,
		messages,
		modelBinding: undefined,
	} as unknown as ContinuationPolicyContext;
}

describe("length truncation replay", () => {
	it("captures a truncation that produced only thinking", () => {
		const last = CAPTURE.messages.at(-1);
		expect(last?.role).toBe("assistant");
		expect(last && "stopReason" in last ? last.stopReason : undefined).toBe("length");
		const content = last?.content;
		expect(Array.isArray(content) ? content.map((part) => part.type) : content).toEqual(["thinking"]);
	});

	it("never injects a fake user turn for that capture", async () => {
		const source = new CodingAgentLengthContinuationSource();

		await expect(source.collect(continuationContext(CAPTURE.messages))).rejects.toThrow(
			"Provider reported a length stop before any visible output (reported output: 3748 tokens)",
		);
	});
});
