import { RuntimeHost, type RuntimeAgentSession } from "@vetta/runtime-core";
import type { RuntimeSnapshotLease } from "@vetta/runtime-core/kernel";
import { createPromptAgent } from "./prompt-agent.js";

export interface RevisionRolloutExampleResult {
	readonly beforeUpdate: { readonly revisionId: string; readonly instruction: string };
	readonly pinnedInstanceAfterUpdate: { readonly revisionId: string; readonly instruction: string };
	readonly newInstanceAfterUpdate: { readonly revisionId: string; readonly instruction: string };
	readonly rollout: { readonly status: "applied" | "unchanged"; readonly revisionId: string };
	readonly inFlightAfterRollout: { readonly revisionId: string; readonly instruction: string };
	readonly nextTurnAfterRollout: { readonly revisionId: string; readonly instruction: string };
}

/** 展示 revision 更新不会改变旧 Instance 或在途 Turn，显式 rollout 只影响下一 Turn。 */
export async function runRevisionRolloutExample(): Promise<RevisionRolloutExampleResult> {
	const host = new RuntimeHost();
	const signal = new AbortController().signal;
	const leases: RuntimeSnapshotLease[] = [];
	const acquire = async (session: RuntimeAgentSession, operationId: string): Promise<RuntimeSnapshotLease> => {
		const lease = await session.acquire({
			sessionId: session.id,
			operationId,
			reason: "preview",
			signal,
		});
		leases.push(lease);
		return lease;
	};

	try {
		host.agents.registry.upsert({
			source: { id: "example-code", revision: "reviewer-1" },
			definition: createPromptAgent({ id: "reviewer", instruction: "Review with policy v1." }),
		});
		const existingInstance = await host.agents.createInstance({
			agentId: "reviewer",
			instanceId: "reviewer-existing",
		});
		const existingSession = await existingInstance.createSession({ sessionId: "reviewer-existing-session" });
		const inFlightLease = await acquire(existingSession, "turn-before-update");
		const beforeUpdateRevisionId = existingSession.revisionId;

		host.agents.registry.upsert({
			source: { id: "example-code", revision: "reviewer-2" },
			definition: createPromptAgent({ id: "reviewer", instruction: "Review with policy v2." }),
		});

		const pinnedSession = await existingInstance.createSession({ sessionId: "reviewer-pinned-session" });
		const pinnedLease = await acquire(pinnedSession, "turn-pinned-instance");
		const newInstance = await host.agents.createInstance({
			agentId: "reviewer",
			instanceId: "reviewer-new",
		});
		const newSession = await newInstance.createSession({ sessionId: "reviewer-new-session" });
		const newInstanceLease = await acquire(newSession, "turn-new-instance");

		const rollout = await existingSession.rolloutToLatest();
		const nextTurnLease = await acquire(existingSession, "turn-after-rollout");

		return {
			beforeUpdate: {
				revisionId: beforeUpdateRevisionId,
				instruction: inFlightLease.snapshot.instructions[0]?.content ?? "",
			},
			pinnedInstanceAfterUpdate: {
				revisionId: pinnedSession.revisionId,
				instruction: pinnedLease.snapshot.instructions[0]?.content ?? "",
			},
			newInstanceAfterUpdate: {
				revisionId: newSession.revisionId,
				instruction: newInstanceLease.snapshot.instructions[0]?.content ?? "",
			},
			rollout: { status: rollout.status, revisionId: rollout.revisionId },
			inFlightAfterRollout: {
				revisionId: beforeUpdateRevisionId,
				instruction: inFlightLease.snapshot.instructions[0]?.content ?? "",
			},
			nextTurnAfterRollout: {
				revisionId: existingSession.revisionId,
				instruction: nextTurnLease.snapshot.instructions[0]?.content ?? "",
			},
		};
	} finally {
		try {
			await Promise.all(leases.reverse().map((lease) => lease.release()));
		} finally {
			await host.close();
		}
	}
}
