import type { TeamSessionDocument, TeamWorkItem } from "@vetta/agent-team";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import type { TeamCollaborationState } from "./team-collaboration-store.js";
import { planTeamInitiatorContinuation } from "./team-initiator-continuation.js";

const session = { id: "team-session", modelSettings: { modelKey: "openai/gpt-test" } } as TeamSessionDocument;
const records: SessionContextRecord[] = [
	{ type: "agent-team.task-completed.v1", content: [], modelVisible: true, display: false, timestamp: 1 },
];

function item(overrides: Partial<TeamWorkItem>): TeamWorkItem {
	return {
		id: `work:${overrides.requestTurnId ?? "request"}:leader`,
		requestTurnId: "request",
		createdByParticipantId: "local-user",
		assignedToParticipantId: "leader",
		objective: "Report",
		contextEntryIds: [],
		state: "completed",
		createdAt: 1,
		updatedAt: 1,
		revision: 1,
		...overrides,
	};
}

function state(workItems: TeamWorkItem[]): TeamCollaborationState {
	return {
		workItems,
		attempts: [],
		deliveries: [],
		publications: [],
		checkpoints: [],
		contextGenerations: [],
		contextReceipts: [],
	};
}

describe("planTeamInitiatorContinuation", () => {
	it("leaves an initiator without Team work, or with a running attempt, to a plain Runtime continuation", () => {
		expect(planTeamInitiatorContinuation({ session, state: state([]), memberId: "leader", records })).toBeUndefined();
		expect(
			planTeamInitiatorContinuation({
				session,
				state: state([item({ state: "running" })]),
				memberId: "leader",
				records,
			}),
		).toBeUndefined();
	});

	it("continues the latest open work item so the answer joins the interrupted request", () => {
		const plan = planTeamInitiatorContinuation({
			session,
			state: state([item({ requestTurnId: "older", createdAt: 1 }), item({ state: "waiting", createdAt: 2 })]),
			memberId: "leader",
			records,
		});

		expect(plan).toMatchObject({
			workItemId: "work:request:leader",
			request: {
				requestId: "request",
				promptText: "Report",
				createdByParticipantId: "local-user",
				mode: "continue",
				modelKey: "openai/gpt-test",
				continuationContext: records,
			},
		});
	});

	it("numbers follow-up work from the original request once earlier follow-ups completed", () => {
		const plan = planTeamInitiatorContinuation({
			session,
			state: state([
				item({ createdAt: 1 }),
				item({ requestTurnId: "request:continuation:1", objective: "Integrate", createdAt: 2 }),
			]),
			memberId: "leader",
			records,
		});

		expect(plan).toMatchObject({
			workItemId: "work:request:continuation:2:leader",
			request: { requestId: "request:continuation:2", sourceTurnId: "request:continuation:2:leader" },
		});
	});
});
