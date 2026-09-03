import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DefaultChatView } from "./DefaultChatView";

const capturedProps = vi.hoisted(() => ({
	messageList: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@domains/activity-panel/components/ActivityPanel", () => ({
	ActivityPanel: () => createElement("aside", { "data-testid": "activity-panel" }),
	ConversationActivityPanel: () => createElement("aside", { "data-testid": "activity-panel" }),
}));

vi.mock("../ChatExportHost", () => ({
	ChatExportHost: () => null,
}));

vi.mock("../MessageList", () => ({
	MessageList: (props: Record<string, unknown>) => {
		capturedProps.messageList = props;
		return createElement("div", { "data-testid": "message-list" });
	},
}));

describe("DefaultChatView layout", () => {
	it("keeps the activity panel outside the input column (drop is owned by InputBar card)", () => {
		const html = renderToStaticMarkup(
			<DefaultChatView
				messages={[]}
				isStreaming={false}
				sessionId="session-1"
				onAbort={vi.fn(async () => {})}
				onSend={vi.fn(async () => {})}
			>
				<div data-testid="input-bar" />
			</DefaultChatView>,
		);

		const messageList = html.indexOf('data-testid="message-list"');
		const inputBar = html.indexOf('data-testid="input-bar"');
		const activityPanel = html.indexOf('data-testid="activity-panel"');

		expect(messageList).toBeLessThan(inputBar);
		expect(inputBar).toBeLessThan(activityPanel);
	});

	it("does not expose session startup state as presentation or interaction props", () => {
		renderToStaticMarkup(
			<DefaultChatView
				messages={[]}
				isStreaming={false}
				sessionId={null}
				onAbort={vi.fn(async () => {})}
				onSend={vi.fn(async () => {})}
			>
				<div data-testid="input-bar" data-cwd="C:/repo" />
			</DefaultChatView>,
		);

		expect(capturedProps.messageList?.pendingLabel).toBeUndefined();
	});
});
