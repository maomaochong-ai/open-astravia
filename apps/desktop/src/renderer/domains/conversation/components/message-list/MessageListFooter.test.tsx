// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
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
	MessageListFooter: {
		Root: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		Presence: ({ children }: { children: ReactNode }) => <>{children}</>,
		Pending: ({ label }: { label: string }) => <span>{label}</span>,
		Compacting: ({ label }: { label: string }) => <span>{label}</span>,
		Retry: ({ detail, label }: { detail?: string; label: string }) => (
			<div>
				<span>{label}</span>
				{detail ? <span>{detail}</span> : null}
			</div>
		),
		Waiting: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	},
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
				<MessageListFooter isCompacting={false} waiting />
			</Provider>,
		);

		expect(screen.getByText("正在重新连接（1/3）")).toBeTruthy();
		expect(screen.getByText("上次请求失败：服务暂时出了点问题")).toBeTruthy();
	});

	it("shows session startup status in the message list footer", () => {
		render(
			<Provider store={store}>
				<MessageListFooter isCompacting={false} pendingLabel="正在启动会话" waiting={false} />
			</Provider>,
		);

		expect(screen.getByText("正在启动会话")).toBeTruthy();
	});
});
