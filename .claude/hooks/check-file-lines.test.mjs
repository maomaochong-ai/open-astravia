import { describe, expect, it } from "vitest";
import { buildReminder, evaluateHookInput, formatHookOutput } from "./check-file-lines.mjs";

describe("Claude Code file line hook", () => {
	it("does not emit a reminder at or below 800 lines", () => {
		expect(buildReminder("src/small.ts", 800)).toBeUndefined();
	});

	it("emits an ignorable maintenance notice above 800 lines", () => {
		const reminder = buildReminder("src/large.ts", 801);

		expect(reminder).toContain("超过 800 行");
		expect(reminder).toContain("可以忽略此提示");
		expect(reminder).toContain("不阻断当前工具调用");
	});

	it("emits a stronger but non-mandatory warning above 1200 lines", () => {
		const reminder = buildReminder("src/very-large.ts", 1201);

		expect(reminder).toContain("超过 1200 行");
		expect(reminder).toContain("保持警惕");
		expect(reminder).toContain("不要求中断当前任务处理");
		expect(reminder).toContain("可在你判断确有必要且符合项目规范时再处理");
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
				additionalContext: expect.stringContaining("`src/large.ts` 当前 900 行"),
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
