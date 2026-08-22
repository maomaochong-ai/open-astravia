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
				"messageList.navigation.title": "Message timeline",
				"messageList.navigation.count": `${values?.count} turns`,
				"messageList.navigation.open": `Open turn ${values?.current}/${values?.total}`,
				"messageList.navigation.searchLabel": "Search messages",
				"messageList.navigation.searchPlaceholder": "Search messages",
				"messageList.navigation.noResults": "No matches",
				"messageList.navigation.turn": `Turn ${values?.turn}`,
				"messageList.navigation.userRole": "You",
				"messageList.navigation.assistantRole": "Vetta",
				"messageList.navigation.emptyUser": "Empty user",
				"messageList.navigation.emptyAssistant": "Processing",
			};
			return labels[key] ?? key;
		},
	}),
}));

vi.mock("@shared/components/ui/popover", () => ({
	Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
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
		expect(screen.queryByRole("button", { name: /Open turn/ })).toBeNull();
	});

	it("filters by full conversation text and navigates to the exact message index", async () => {
		const onNavigate = vi.fn();
		render(<MessageTimeline activeMessageIndex={0} messages={conversation(8)} onNavigate={onNavigate} />);
		const user = userEvent.setup();

		expect(screen.getByRole("button", { name: "Open turn 1/8" })).toBeTruthy();
		await user.type(screen.getByRole("searchbox", { name: "Search messages" }), "launch plan");

		expect(screen.getByText("Find the launch plan")).toBeTruthy();
		expect(screen.getByText("Answer 5")).toBeTruthy();
		expect(screen.queryByText("Question 1")).toBeNull();

		await user.click(screen.getByText("Answer 5"));
		expect(onNavigate).toHaveBeenCalledWith(11);
	});
});
