// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatComposer, ChatError, DefaultChatView } from "./DefaultChatView";

const workspace = { id: "conversation:test", cwd: null, runtimeIds: [] };
const panelRenders = vi.hoisted(() => ({ count: 0 }));

vi.mock("@domains/activity-panel/components/ActivityPanel", () => ({
	ActivityPanel: () => {
		panelRenders.count += 1;
		return createElement("aside", { "data-testid": "activity-panel" });
	},
	CurrentScenarioActivityPanel: () => {
		panelRenders.count += 1;
		return createElement("aside", { "data-testid": "activity-panel" });
	},
}));

vi.mock("../ChatExportHost", () => ({
	ChatExportHost: () => null,
}));

describe("DefaultChatView layout", () => {
	beforeEach(() => {
		panelRenders.count = 0;
	});

	it("keeps the activity panel outside the input column (drop is owned by InputBar card)", () => {
		const html = renderToStaticMarkup(
			<DefaultChatView messages={[]} workspace={workspace}>
				<div data-testid="message-list" />
				<ChatError>Send failed</ChatError>
				<ChatComposer>
					<div data-testid="input-bar" />
				</ChatComposer>
			</DefaultChatView>,
		);

		const messageList = html.indexOf('data-testid="message-list"');
		const inputBar = html.indexOf('data-testid="input-bar"');
		const activityPanel = html.indexOf('data-testid="activity-panel"');

		expect(messageList).toBeLessThan(inputBar);
		expect(html.indexOf('role="alert"')).toBeGreaterThan(messageList);
		expect(html.indexOf('role="alert"')).toBeLessThan(inputBar);
		expect(inputBar).toBeLessThan(activityPanel);
	});

	it("can compose a read-only feed without mounting a composer", () => {
		const html = renderToStaticMarkup(
			<DefaultChatView messages={[]} workspace={workspace}>
				<div data-testid="read-only-feed" />
			</DefaultChatView>,
		);

		expect(html).toContain('data-testid="read-only-feed"');
		expect(html).not.toContain('data-testid="input-bar"');
	});

	it("does not remount the activity panel when only the transcript grows", () => {
		const { rerender } = render(
			<DefaultChatView messages={[]} workspace={workspace}>
				<div />
			</DefaultChatView>,
		);
		expect(panelRenders.count).toBe(1);

		rerender(
			<DefaultChatView messages={[{ id: "m1" } as never]} workspace={{ ...workspace }}>
				<div />
			</DefaultChatView>,
		);
		expect(panelRenders.count).toBe(1);
	});
});
