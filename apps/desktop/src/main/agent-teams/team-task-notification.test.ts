import { describe, expect, it, vi } from "vitest";
import {
	createTeamTaskCompletionNotification,
	deliverTeamTaskCompletionNotification,
	TEAM_TASK_COMPLETED_CONTEXT_TYPE,
} from "./team-task-notification.js";

describe("team task completion notification", () => {
	it("creates a model-visible, non-display status record with result correlation", () => {
		const notification = createTeamTaskCompletionNotification({
			teamTaskId: "work:task-1",
			assignedToParticipantId: "researcher",
			requestTurnId: "turn-1",
			resultMessageId: "result-1",
			resultText: "The research is complete.",
			timestamp: 123,
		});

		expect(notification).toMatchObject({
			type: TEAM_TASK_COMPLETED_CONTEXT_TYPE,
			modelVisible: true,
			display: false,
			timestamp: 123,
			metadata: {
				teamTaskId: "work:task-1",
				resultMessageId: "result-1",
				resultText: "The research is complete.",
			},
		});
		const content = notification.content[0];
		expect(content).toMatchObject({ type: "text" });
		expect(typeof content === "object" && content !== null && "text" in content ? content.text : "").toContain(
			"team-task-completed",
		);
	});

	it("requests a continuation on the initiating member runtime", async () => {
		const deliverSessionContext = vi.fn(async () => undefined);
		await deliverTeamTaskCompletionNotification({ deliverSessionContext }, "leader-runtime", {
			teamTaskId: "work:task-1",
			assignedToParticipantId: "builder",
			requestTurnId: "turn-1",
			resultMessageId: "result-1",
			resultText: "done",
		});
		expect(deliverSessionContext).toHaveBeenCalledWith(
			"leader-runtime",
			[expect.objectContaining({ type: TEAM_TASK_COMPLETED_CONTEXT_TYPE, modelVisible: true })],
			"triggerTurn",
		);
	});
});
