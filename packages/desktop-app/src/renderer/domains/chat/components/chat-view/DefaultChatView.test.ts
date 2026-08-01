import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DefaultChatView } from "./DefaultChatView";

vi.mock("@domains/activity-panel/components/ActivityPanel", () => ({
	ActivityPanel: () => createElement("aside", { "data-testid": "activity-panel" }),
}));

vi.mock("../ChatExportHost", () => ({
	ChatExportHost: () => null,
}));

vi.mock("../InputBar", () => ({
	InputBar: () => createElement("div", { "data-testid": "input-bar" }),
}));

vi.mock("../MessageList", () => ({
	MessageList: () => createElement("div", { "data-testid": "message-list" }),
}));

describe("DefaultChatView layout", () => {
	it("keeps the activity panel outside the input column (drop is owned by InputBar card)", () => {
		const html = renderToStaticMarkup(
			createElement(DefaultChatView, {
				actions: {
					finishExport: vi.fn(),
					openExport: vi.fn(),
					togglePanel: vi.fn(),
					togglePin: vi.fn(async () => {}),
				},
				model: {
					exporting: false,
					exportTitle: "Session",
					header: {
						exportDisabled: false,
						exporting: false,
						exportTitle: "Export",
						panelOpen: true,
						panelTitle: "Panel",
						pinTitle: "Pin",
						pinned: false,
					},
					isStreaming: false,
					messages: [],
					sessionId: "session-1",
				},
				onAbort: vi.fn(async () => {}),
				onSend: vi.fn(async () => {}),
				onSendQueued: vi.fn(async () => {}),
			}),
		);

		const messageList = html.indexOf('data-testid="message-list"');
		const inputBar = html.indexOf('data-testid="input-bar"');
		const activityPanel = html.indexOf('data-testid="activity-panel"');

		expect(messageList).toBeLessThan(inputBar);
		expect(inputBar).toBeLessThan(activityPanel);
	});
});
