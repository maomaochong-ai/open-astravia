import { createElement, type ReactNode } from "react";
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

vi.mock("../SessionDropZone", () => ({
	SessionDropZone: ({ children }: { children: ReactNode }) =>
		createElement(
			"section",
			{ "data-testid": "session-drop-zone" },
			createElement("span", { "data-testid": "drop-zone-start" }),
			children,
			createElement("span", { "data-testid": "drop-zone-end" }),
		),
}));

describe("DefaultChatView drop scope", () => {
	it("limits the session drop zone to the input bar and leaves the activity panel outside", () => {
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
		const dropStart = html.indexOf('data-testid="drop-zone-start"');
		const inputBar = html.indexOf('data-testid="input-bar"');
		const dropEnd = html.indexOf('data-testid="drop-zone-end"');
		const activityPanel = html.indexOf('data-testid="activity-panel"');

		expect(messageList).toBeLessThan(dropStart);
		expect(dropStart).toBeLessThan(inputBar);
		expect(inputBar).toBeLessThan(dropEnd);
		expect(dropEnd).toBeLessThan(activityPanel);
	});
});
