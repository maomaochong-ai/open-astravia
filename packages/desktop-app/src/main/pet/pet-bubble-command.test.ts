import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mainT: vi.fn() }));

vi.mock("../i18n/index.js", () => ({ mainT: mocks.mainT }));

import { createPetBubbleCommand } from "./pet-bubble-command.js";

describe("createPetBubbleCommand", () => {
	beforeEach(() => {
		mocks.mainT.mockReset();
		mocks.mainT.mockReturnValue("正在读取 README.md");
	});

	it("resolves display text while preserving structured notice metadata", () => {
		const command = createPetBubbleCommand(
			{
				kind: "tool",
				messageKey: "notice.tool.runningWithDescription",
				params: { description: "正在读取 README.md" },
				dedupeKey: "session-status",
				ttlMs: 3_000,
			},
			"session-1",
		);

		expect(mocks.mainT).toHaveBeenCalledWith("pet:notice.tool.runningWithDescription", {
			description: "正在读取 README.md",
		});
		expect(command).toMatchObject({
			type: "show-bubble",
			text: "正在读取 README.md",
			source: "app",
			notice: {
				kind: "tool",
				messageKey: "notice.tool.runningWithDescription",
				dedupeKey: "session-status",
				sessionId: "session-1",
				text: "正在读取 README.md",
			},
		});
	});

	it("keeps custom text notices compatible without invoking i18n", () => {
		expect(createPetBubbleCommand({ text: "自定义消息" })).toMatchObject({
			type: "show-bubble",
			text: "自定义消息",
		});
		expect(mocks.mainT).not.toHaveBeenCalled();
	});

	it("prefers dynamic body over the translated fallback", () => {
		const command = createPetBubbleCommand({
			body: "已经完成配置迁移",
			messageKey: "notice.lifecycle.completed",
		});

		expect(command).toMatchObject({ type: "show-bubble", text: "已经完成配置迁移" });
		expect(mocks.mainT).not.toHaveBeenCalled();
	});
});
