import { createRuntimeObservationPublisher, type RuntimeObservationRecord } from "@vetta/runtime-core/observation";
import { describe, expect, it, vi } from "vitest";
import {
	AGENT_TEAM_MEMBER_RUNTIME_LIFECYCLE,
	AGENT_TEAM_SESSION_LIFECYCLE,
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
		await publisher.flush();

		expect(records.map((record) => record.token)).toEqual([
			AGENT_TEAM_SESSION_LIFECYCLE,
			AGENT_TEAM_MEMBER_RUNTIME_LIFECYCLE,
		]);
		expect(records[0]?.context.sessionId).toBe("conversation-team");
		expect(records[1]?.context).toMatchObject({ sessionId: "conversation-team", turnId: "turn-builder" });
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
});
