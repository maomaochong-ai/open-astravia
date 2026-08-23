// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Fragment, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { MessageTimeline } from "./MessageTimeline";
import type { ChatMessage } from "./types";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) => {
			const labels: Record<string, string> = {
				"messageList.navigation.title": "Questions",
				"messageList.navigation.count": `${values?.count}`,
				"messageList.navigation.open": "View questions",
				"messageList.navigation.close": "Close question list",
				"messageList.navigation.searchLabel": "Search questions",
				"messageList.navigation.searchPlaceholder": "Search questions",
				"messageList.navigation.noResults": "No matching questions",
				"messageList.navigation.jumpTo": `Jump to ${values?.preview}`,
				"messageList.navigation.emptyUser": "(No text)",
			};
			return labels[key] ?? key;
		},
	}),
}));

vi.mock("@shared/shortcuts", () => ({
	useShortcutScope: () => undefined,
}));

vi.mock("react-virtuoso", () => ({
	Virtuoso: ({
		data,
		itemContent,
	}: {
		data: Array<{ id: string }>;
		itemContent: (index: number, entry: { id: string }) => ReactNode;
	}) => (
		<div>
			{data.map((entry, index) => (
				<Fragment key={entry.id}>{itemContent(index, entry)}</Fragment>
			))}
		</div>
	),
}));

function conversation(turns: number): ChatMessage[] {
	return Array.from({ length: turns }).flatMap((_, index) => [
		{ id: `user-${index}`, role: "user" as const, text: index === 5 ? "Find the launch plan" : `Question ${index}` },
		{ id: `assistant-${index}`, role: "assistant" as const, text: `Answer ${index}` },
	]);
}

describe("MessageTimeline", () => {
	it("stays hidden below the long-conversation threshold", () => {
		render(<MessageTimeline activeMessageIndex={0} messages={conversation(7)} onNavigate={vi.fn()} />);
		expect(screen.queryByRole("button", { name: "View questions" })).toBeNull();
	});

	it("keeps the question list closed until the outline is opened", () => {
		render(<MessageTimeline activeMessageIndex={0} messages={conversation(8)} onNavigate={vi.fn()} />);

		expect(screen.getByRole("button", { name: "View questions" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Jump to Question 0" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Question 0" })).toBeNull();
		expect(screen.queryByRole("searchbox", { name: "Search questions" })).toBeNull();
	});

	it("shows user questions rather than a turn-by-turn role list", async () => {
		render(<MessageTimeline activeMessageIndex={0} messages={conversation(8)} onNavigate={vi.fn()} />);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "View questions" }));

		expect(screen.getByRole("button", { name: "Question 0" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Find the launch plan" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Answer 0" })).toBeNull();
		expect(screen.queryByText("Turn 1")).toBeNull();
	});

	it("filters by full conversation text and jumps to the matching message without closing", async () => {
		const onNavigate = vi.fn();
		render(<MessageTimeline activeMessageIndex={0} messages={conversation(8)} onNavigate={onNavigate} />);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "View questions" }));
		await user.type(screen.getByRole("searchbox", { name: "Search questions" }), "Answer 5");

		const match = screen.getByRole("button", { name: "Find the launch plan Answer 5" });
		expect(match).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Question 1" })).toBeNull();

		await user.click(match);
		expect(onNavigate).toHaveBeenCalledWith(11);
		expect(screen.getByRole("searchbox", { name: "Search questions" })).toBeTruthy();
	});

	it("keeps enough question text on a rail tick to preview several lines", () => {
		const question =
			"请帮我检查登录页提交后白屏的问题，控制台会出现 hydration mismatch，并对照最近一次改动里表单校验、错误边界和路由守卫的先后顺序，给出可以落地的修复建议。";
		const messages = Array.from({ length: 8 }).flatMap((_, index) => [
			{ id: `user-${index}`, role: "user" as const, text: index === 0 ? question : `Question ${index}` },
			{ id: `assistant-${index}`, role: "assistant" as const, text: `Answer ${index}` },
		]);
		render(<MessageTimeline activeMessageIndex={0} messages={messages} onNavigate={vi.fn()} />);

		expect(
			screen.getByRole("button", { name: /Jump to 请帮我检查登录页提交后白屏的问题/ }).textContent,
		).toContain("给出可以落地的修复建议");
	});

	it("jumps from a rail tick without opening the outline list", async () => {
		const onNavigate = vi.fn();
		render(<MessageTimeline activeMessageIndex={0} messages={conversation(8)} onNavigate={onNavigate} />);

		await userEvent.click(screen.getByRole("button", { name: "Jump to Question 0" }));
		expect(onNavigate).toHaveBeenCalledWith(0);
		expect(screen.queryByRole("searchbox", { name: "Search questions" })).toBeNull();
	});

	it("closes the outline from the panel close button", async () => {
		render(<MessageTimeline activeMessageIndex={0} messages={conversation(8)} onNavigate={vi.fn()} />);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "View questions" }));
		expect(screen.getByRole("searchbox", { name: "Search questions" })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Close question list" }));
		expect(screen.queryByRole("searchbox", { name: "Search questions" })).toBeNull();
	});

	it("closes the outline when clicking outside", async () => {
		render(
			<div>
				<button type="button">outside</button>
				<MessageTimeline activeMessageIndex={0} messages={conversation(8)} onNavigate={vi.fn()} />
			</div>,
		);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "View questions" }));
		expect(screen.getByRole("searchbox", { name: "Search questions" })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "outside" }));
		expect(screen.queryByRole("searchbox", { name: "Search questions" })).toBeNull();
	});
});
