import { describe, expect, it } from "vitest";
import { goalStatusDetailKey } from "./goal-status-detail";

/**
 * 这几句是运行时真实写出的原文：coding-agent `goal-runtime.ts`（恢复、连续失败、
 * 无进展）与 desktop main `desktop-goal-controller.ts`（启动 / 恢复失败）。
 */
const RUNTIME_DETAILS: ReadonlyArray<{ detail: string; key: string }> = [
	{
		detail: "Restored after the session stopped; resume explicitly to continue",
		key: "goalMode.statusDetail.restored",
	},
	{
		detail: "Execution failed for three consecutive goal turns; review the failure before resuming",
		key: "goalMode.statusDetail.executionFailed",
	},
	{
		detail:
			"No observable progress was produced for three consecutive goal continuations; review the goal before resuming",
		key: "goalMode.statusDetail.noProgress",
	},
	{ detail: "The session could not start", key: "goalMode.statusDetail.sessionStartFailed" },
	{ detail: "The session could not resume", key: "goalMode.statusDetail.sessionResumeFailed" },
];

describe("goalStatusDetailKey", () => {
	for (const { detail, key } of RUNTIME_DETAILS) {
		it(`把运行时的原因映射到 i18n 键：${detail.slice(0, 32)}…`, () => {
			expect(goalStatusDetailKey(detail)).toBe(key);
		});
	}

	it("用户或模型写下的自定义说明原样回落", () => {
		expect(goalStatusDetailKey("等设计稿确认后再继续")).toBeUndefined();
		expect(goalStatusDetailKey("")).toBeUndefined();
		expect(goalStatusDetailKey(undefined)).toBeUndefined();
	});

	it("去掉首尾空白后再匹配", () => {
		expect(goalStatusDetailKey("  The session could not start \n")).toBe("goalMode.statusDetail.sessionStartFailed");
	});
});
