import { createRuntimeObservationPublisher, type RuntimeObservationRecord } from "@vetta/runtime-core/observation";
import { describe, expect, it, vi } from "vitest";
import {
	AGENT_TEAM_MEMBER_RUNTIME_LIFECYCLE,
	AGENT_TEAM_MEMBER_TOOL_EXECUTION,
	AGENT_TEAM_PUBLICATION_LIFECYCLE,
	AGENT_TEAM_SESSION_LIFECYCLE,
	AGENT_TEAM_SHARED_CONTEXT_SUMMARY,
	correlateTeamMemberToolExecution,
	createTeamObservationPublisher,
} from "../src/observability.js";

describe("Agent Team observations", () => {
	it("publishes stable correlation through the shared Runtime publisher", async () => {
		const records: RuntimeObservationRecord[] = [];
		const publisher = createRuntimeObservationPublisher({ port: { record: (record) => records.push(record) } });
		const observations = createTeamObservationPublisher(publisher, "conversation-team");
		observations.publishLifecycle({
			teamId: "team",
			coordinationConversationId: "conversation-team",
			phase: "create",
			teamRevision: 2,
			memberCount: 3,
		});
		observations.publishMemberRuntime({
			teamId: "team",
			coordinationConversationId: "conversation-team",
			participantId: "builder",
			sourceTurnId: "turn-builder",
			attemptId: "attempt-1",
			phase: "start",
			attempt: 1,
		});
		observations.publishSharedContextSummary({
			teamId: "team",
			coordinationConversationId: "conversation-team",
			requestTurnId: "turn-leader",
			phase: "completed",
			projectionPolicyId: "public-results-v1",
			sourceEntryCount: 8,
			summarizedEntryCount: 6,
			retainedEntryCount: 2,
			checkpointId: "checkpoint-1",
			sourceFingerprint: "fingerprint-1",
			summary: "Public decisions and open work.",
		});
		observations.publishPublication({
			teamId: "team",
			coordinationConversationId: "conversation-team",
			participantId: "builder",
			workItemId: "work-1",
			attemptId: "attempt-1",
			requestTurnId: "turn-leader",
			sourceTurnId: "turn-builder",
			resultMessageId: "public-message-1",
			operationId: "publication-1",
			phase: "completed",
			sourceParticipantConversationId: "member-conversation",
			sourceMessageEntryId: "private-message-1",
			generation: 1,
			recovered: true,
		});
		await publisher.flush();

		expect(records.map((record) => record.token)).toEqual([
			AGENT_TEAM_SESSION_LIFECYCLE,
			AGENT_TEAM_MEMBER_RUNTIME_LIFECYCLE,
			AGENT_TEAM_SHARED_CONTEXT_SUMMARY,
			AGENT_TEAM_PUBLICATION_LIFECYCLE,
		]);
		expect(records[0]?.context.sessionId).toBe("conversation-team");
		expect(records[1]?.context).toMatchObject({ sessionId: "conversation-team", turnId: "turn-builder" });
		expect(records[2]?.payload).toMatchObject({
			phase: "completed",
			checkpointId: "checkpoint-1",
			summary: "Public decisions and open work.",
		});
		expect(records[3]).toMatchObject({
			context: { sessionId: "conversation-team", turnId: "turn-builder" },
			payload: { phase: "completed", operationId: "publication-1", recovered: true },
		});
	});

	it("isolates Observer failures from the publishing caller", async () => {
		const onPortError = vi.fn();
		const publisher = createRuntimeObservationPublisher({
			port: { record: () => Promise.reject(new Error("observer failed")) },
			onPortError,
		});
		const observations = createTeamObservationPublisher(publisher, "conversation-team");

		expect(() =>
			observations.publishLifecycle({
				teamId: "team",
				coordinationConversationId: "conversation-team",
				phase: "restore",
				teamRevision: 1,
				memberCount: 1,
			}),
		).not.toThrow();
		await publisher.flush();
		expect(onPortError).toHaveBeenCalledOnce();
	});

	it("joins Runtime tool observations to Team work without copying sensitive content", async () => {
		const rawObservation = {
			turnId: "runtime-turn-7",
			timestamp: 10,
			event: {
				type: "tool.execution.end" as const,
				toolCallId: "tool-call-3",
				toolName: "read",
				result: {
					content: [{ type: "text" as const, text: "private tool output" }],
					details: { secret: "not copied" },
				},
				isError: false,
				startedAt: 1,
				durationMs: 9,
				phases: [],
			},
		};
		const correlated = correlateTeamMemberToolExecution(
			{
				teamId: "team",
				coordinationConversationId: "conversation-team",
				participantId: "builder",
				workItemId: "work-1",
				attemptId: "attempt-2",
				deliveryId: "delivery-4",
				requestTurnId: "request-1",
				sourceTurnId: "source-turn-1",
				runtimeSessionId: "member-conversation",
			},
			rawObservation,
		);
		expect(correlated).toEqual({
			teamId: "team",
			coordinationConversationId: "conversation-team",
			participantId: "builder",
			workItemId: "work-1",
			attemptId: "attempt-2",
			deliveryId: "delivery-4",
			requestTurnId: "request-1",
			sourceTurnId: "source-turn-1",
			runtimeSessionId: "member-conversation",
			runtimeTurnId: "runtime-turn-7",
			toolCallId: "tool-call-3",
			toolName: "read",
			phase: "completed",
			contentItemCount: 1,
			hasDetails: true,
			durationMs: 9,
			isError: false,
		});
		expect(JSON.stringify(correlated)).not.toContain("private tool output");
		expect(JSON.stringify(correlated)).not.toContain("not copied");

		const records: RuntimeObservationRecord[] = [];
		const publisher = createRuntimeObservationPublisher({ port: { record: (record) => records.push(record) } });
		const observations = createTeamObservationPublisher(publisher, "conversation-team");
		if (!correlated) throw new Error("Expected a correlated Team tool observation");
		observations.publishMemberToolExecution(correlated);
		await publisher.flush();

		expect(records[0]).toMatchObject({
			token: AGENT_TEAM_MEMBER_TOOL_EXECUTION,
			context: {
				sessionId: "conversation-team",
				turnId: "runtime-turn-7",
				toolCallId: "tool-call-3",
			},
		});
	});
});
