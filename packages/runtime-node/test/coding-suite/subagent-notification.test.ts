import type { SubagentSnapshot } from "@vetta/runtime-subagents";
import { describe, expect, it } from "vitest";
import { buildSubagentNotification } from "../../src/coding/index.js";

describe("subagent notification projection", () => {
	it("preserves the model-visible protocol outside the scheduling runtime", () => {
		const agent: SubagentSnapshot = {
			id: "child-1",
			taskName: "inspect",
			path: "/root/inspect",
			agentType: "explorer",
			status: "interrupted",
			task: "inspect the repository",
			parentSessionId: "parent-1",
			sessionFile: ".subagents/child-1.conversation.jsonl",
			startedAt: 1,
			endedAt: 2,
			finalText: "partial result",
			usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, costTotal: 5 },
			generation: 1,
			title: "Inspect repository",
		};

		expect(buildSubagentNotification([agent])).toEqual({
			agents: [agent],
			text: [
				"<subagent_notification>",
				"id: child-1",
				"path: /root/inspect",
				"type: explorer",
				"task_name: inspect",
				"title: Inspect repository",
				"status: interrupted",
				"hint: resumable — use followup_task to continue this child with its context and todo progress intact; do NOT re-dispatch it as a new workflow",
				"summary:",
				"partial result",
				"session_file: .subagents/child-1.conversation.jsonl",
				"---",
				"</subagent_notification>",
			].join("\n"),
		});
	});
});
