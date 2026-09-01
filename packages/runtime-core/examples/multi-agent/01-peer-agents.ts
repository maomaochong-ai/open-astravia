import { RuntimeHost } from "@vetta/runtime-core";
import { resolveModelCallFrame } from "@vetta/runtime-core/kernel";
import { createPromptAgent } from "./prompt-agent.js";

export interface PeerAgentsExampleResult {
	readonly writer: {
		readonly instruction: string;
		readonly stablePromptLength: number | undefined;
	};
	readonly reviewer: {
		readonly instruction: string;
		readonly stablePromptLength: number | undefined;
	};
	readonly instances: readonly {
		readonly id: string;
		readonly agentId: string;
		readonly sessionIds: readonly string[];
	}[];
}

/** 在一个 Host 中运行两个平级 Agent，并读取各自隔离的 Turn snapshot。 */
export async function runPeerAgentsExample(): Promise<PeerAgentsExampleResult> {
	const host = new RuntimeHost();
	const signal = new AbortController().signal;

	try {
		host.agents.registry.upsert({
			source: { id: "example-code", revision: "writer-1" },
			definition: createPromptAgent({
				id: "writer",
				instruction: "Draft a concise implementation plan.",
			}),
		});
		host.agents.registry.upsert({
			source: { id: "example-code", revision: "reviewer-1" },
			definition: createPromptAgent({
				id: "reviewer",
				instruction: "Review the plan and report concrete risks.",
			}),
		});

		const writerInstance = await host.agents.createInstance({
			agentId: "writer",
			instanceId: "writer-instance",
		});
		const reviewerInstance = await host.agents.createInstance({
			agentId: "reviewer",
			instanceId: "reviewer-instance",
		});
		const writerSession = await writerInstance.createSession({ sessionId: "writer-session" });
		const reviewerSession = await reviewerInstance.createSession({ sessionId: "reviewer-session" });

		const writerLease = await writerSession.acquire({
			sessionId: writerSession.id,
			operationId: "writer-preview",
			reason: "preview",
			signal,
		});
		try {
			const reviewerLease = await reviewerSession.acquire({
				sessionId: reviewerSession.id,
				operationId: "reviewer-preview",
				reason: "preview",
				signal,
			});
			try {
				const [writerFrame, reviewerFrame] = await Promise.all([
					resolveModelCallFrame(writerLease.snapshot, {
						sessionId: writerSession.id,
						turnId: "writer-turn",
						signal,
					}),
					resolveModelCallFrame(reviewerLease.snapshot, {
						sessionId: reviewerSession.id,
						turnId: "reviewer-turn",
						signal,
					}),
				]);

				return {
					writer: {
						instruction: writerFrame.instructions[0]?.content ?? "",
						stablePromptLength: writerFrame.systemPromptStableLength,
					},
					reviewer: {
						instruction: reviewerFrame.instructions[0]?.content ?? "",
						stablePromptLength: reviewerFrame.systemPromptStableLength,
					},
					instances: host.agents.snapshot().instances.map(({ id, agentId, sessionIds }) => ({
						id,
						agentId,
						sessionIds,
					})),
				};
			} finally {
				await reviewerLease.release();
			}
		} finally {
			await writerLease.release();
		}
	} finally {
		await host.close();
	}
}
