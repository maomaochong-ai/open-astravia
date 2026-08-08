import type { AgentMessage } from "@vetta/agent-core";
import { describe, expect, it, vi } from "vitest";
import { generateCompactionSummaryWithRecovery } from "../src/compaction/summary-generation-recovery.js";
import type { CompactionSummaryInputCandidate } from "../src/compaction/summary-input-degradation.js";

const candidates: readonly CompactionSummaryInputCandidate[] = [
	{ level: "full", messages: [user("full")] },
	{ level: "essential", messages: [user("essential")] },
];
const validSummary = "## Primary Goal\nPreserve the requested architecture and continue implementation safely.";

describe("compaction summary generation recovery", () => {
	it("moves to the next input level only for input-too-large errors", async () => {
		const levels: string[] = [];
		const result = await generateCompactionSummaryWithRecovery(candidates, async (candidate) => {
			levels.push(candidate.level);
			if (candidate.level === "full") throw new Error("prompt is too long");
			return validSummary;
		});

		expect(result).toBe(validSummary);
		expect(levels).toEqual(["full", "essential"]);
	});

	it("retries transient errors on the same level with exponential delays", async () => {
		const wait = vi.fn(async (_delay: number) => {});
		let attempts = 0;
		const result = await generateCompactionSummaryWithRecovery(
			candidates,
			async (candidate) => {
				expect(candidate.level).toBe("full");
				attempts += 1;
				if (attempts < 3) throw new Error("503 service unavailable");
				return validSummary;
			},
			undefined,
			{ wait },
		);

		expect(result).toBe(validSummary);
		expect(attempts).toBe(3);
		expect(wait.mock.calls.map(([delay]) => delay)).toEqual([250, 500]);
	});

	it("rejects repeated degraded summaries instead of committing them", async () => {
		const generate = vi.fn(async () => "sorry");

		await expect(
			generateCompactionSummaryWithRecovery(candidates, generate, undefined, { maxDegradedRetries: 1 }),
		).rejects.toThrow("degraded summary");
		expect(generate).toHaveBeenCalledTimes(2);
	});

	it("does not retry permanent failures", async () => {
		const generate = vi.fn(async () => {
			throw new Error("invalid API key");
		});

		await expect(generateCompactionSummaryWithRecovery(candidates, generate)).rejects.toThrow("invalid API key");
		expect(generate).toHaveBeenCalledOnce();
	});
});

function user(content: string): AgentMessage {
	return { role: "user", content, timestamp: 1 };
}
