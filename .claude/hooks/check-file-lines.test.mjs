import { describe, expect, it } from "vitest";
import { buildReminder, evaluateHookInput, formatHookOutput } from "./check-file-lines.mjs";

describe("Claude Code file line hook", () => {
	it("does not emit a reminder at or below 800 lines", () => {
		expect(buildReminder("src/small.ts", 800)).toBeUndefined();
	});

	it("emits an ignorable maintenance notice above 800 lines", () => {
		const reminder = buildReminder("src/large.ts", 801);

		expect(reminder).toContain("exceeding the 800-line threshold");
		expect(reminder).toContain("you may ignore this notice");
		expect(reminder).toContain("does not block the tool call");
	});

	it("emits a stronger but non-mandatory warning above 1200 lines", () => {
		const reminder = buildReminder("src/very-large.ts", 1201);

		expect(reminder).toContain("exceeding the 1200-line threshold");
		expect(reminder).toContain("with extra caution");
		expect(reminder).toContain("you do not need to interrupt the current task");
		expect(reminder).toContain("if you consider that necessary");
		expect(reminder).toContain("no cleanup is mandatory");
	});

	it("checks the edited file and returns official PostToolUse context JSON", async () => {
		const reminder = await evaluateHookInput(
			{
				cwd: "C:\\repo",
				hook_event_name: "PostToolUse",
				tool_name: "Edit",
				tool_input: { file_path: "src\\large.ts" },
			},
			async (filePath) => {
				expect(filePath).toBe("C:\\repo\\src\\large.ts");
				return 900;
			},
		);
		const output = JSON.parse(formatHookOutput(reminder));

		expect(output).toEqual({
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext: expect.stringContaining("`src/large.ts` now has 900 lines"),
			},
		});
	});

	it("silently ignores unrelated or malformed hook input", async () => {
		expect(await evaluateHookInput({ hook_event_name: "PreToolUse" })).toBeUndefined();
		expect(
			await evaluateHookInput({
				hook_event_name: "PostToolUse",
				tool_name: "Write",
				tool_input: {},
			}),
		).toBeUndefined();
	});
});
