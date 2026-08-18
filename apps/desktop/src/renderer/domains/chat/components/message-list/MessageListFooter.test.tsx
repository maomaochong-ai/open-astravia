// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) => {
			if (key === "messageList.retryIndicator") return `正在重新连接（${values?.attempt}/${values?.maxAttempts}）`;
			if (key === "messageList.retryReason") return `上次请求失败：${values?.reason}`;
			if (key === "messageList.errorBlock.kinds.server.title") return "服务暂时出了点问题";
			return key;
		},
	}),
}));

vi.mock("@vetta/theme-ui/chat", () => ({
	MessageListFooterView: ({ retryDetail, retryLabel }: { retryDetail?: string; retryLabel?: string }) => (
		<div>
			{retryLabel ? <span>{retryLabel}</span> : null}
			{retryDetail ? <span>{retryDetail}</span> : null}
		</div>
	),
}));
vi.mock("../../../plugins/components/PluginTurnCardHost", () => ({ PluginTurnCardHost: () => null }));
vi.mock("./AssistantMessage", () => ({ StreamingIndicator: () => null }));
vi.mock("./WorkflowFooterItems", () => ({ WorkflowFooterItems: () => null }));

import { retryProgressAtom } from "@shared/store/atoms";
import { MessageListFooter } from "./MessageListFooter";

describe("MessageListFooter retry progress", () => {
	const store = createStore();

	beforeEach(() => store.set(retryProgressAtom, null));

	it("shows the reconnect attempt and a user-friendly reason", () => {
		store.set(retryProgressAtom, {
			attempt: 1,
			maxAttempts: 3,
			errorMessage: "503 service unavailable",
		});

		render(
			<Provider store={store}>
				<MessageListFooter isCompacting={false} showWaiting />
			</Provider>,
		);

		expect(screen.getByText("正在重新连接（1/3）")).toBeTruthy();
		expect(screen.getByText("上次请求失败：服务暂时出了点问题")).toBeTruthy();
	});
});
