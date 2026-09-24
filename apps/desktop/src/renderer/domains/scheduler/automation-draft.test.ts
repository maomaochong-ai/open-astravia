import { describe, expect, it } from "vitest";
import {
	type AutomationDraft,
	automationDraftToInput,
	canSubmitAutomationDraft,
	emptyAutomationDraft,
} from "./automation-draft";

function draftWith(patch: Partial<AutomationDraft>): AutomationDraft {
	return { ...emptyAutomationDraft({ conversationCwd: "C:/default", template: "t", now: 0 }), ...patch };
}

describe("automation draft title", () => {
	it("lets a new task be created with only a prompt and titles it from the prompt's first line", () => {
		const draft = draftWith({ prompt: "\n  Summarize today's commits  \nThen email me" });
		expect(canSubmitAutomationDraft(draft)).toBe(true);
		expect(automationDraftToInput(draft).name).toBe("Summarize today's commits");
	});

	it("skips the leading skill token, falls back to the skill name, and truncates long lines", () => {
		expect(automationDraftToInput(draftWith({ prompt: "@skill:review Check open PRs" })).name).toBe("Check open PRs");
		expect(automationDraftToInput(draftWith({ prompt: "@skill:review " })).name).toBe("review");
		expect(automationDraftToInput(draftWith({ prompt: "长".repeat(50) })).name).toBe(`${"长".repeat(40)}…`);
	});

	it("keeps an explicit title and still requires a prompt", () => {
		expect(automationDraftToInput(draftWith({ name: "  Daily  ", prompt: "Summarize" })).name).toBe("Daily");
		expect(canSubmitAutomationDraft(draftWith({ name: "Daily", prompt: "   " }))).toBe(false);
	});
});
