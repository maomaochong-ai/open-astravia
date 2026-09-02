// @vitest-environment jsdom

import {
	Message,
	MessageFeed,
	MessageFeedLayout,
	MessageLayout,
	MessageVisual,
} from "@vetta/theme-ui/chat";
import { render, screen } from "@testing-library/react";
import type { ComponentType, HTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-virtuoso", () => ({
	Virtuoso: (props: {
		readonly data: readonly { readonly key: string; readonly text: string }[];
		readonly itemContent: (
			index: number,
			item: { readonly key: string; readonly text: string },
		) => ReactNode;
		readonly computeItemKey?: (
			index: number,
			item: { readonly key: string; readonly text: string },
		) => string | number;
		readonly components?: {
			readonly Footer?: () => ReactNode;
			readonly List?: ComponentType<HTMLAttributes<HTMLDivElement>>;
		};
		readonly className?: string;
		readonly style?: HTMLAttributes<HTMLDivElement>["style"];
	}) => {
		const List = props.components?.List ?? "div";
		return (
			<div data-testid="virtualizer" className={props.className} style={props.style}>
				<List>
					{props.data.map((item, index) => (
						<div key={props.computeItemKey?.(index, item) ?? index}>
							{props.itemContent(index, item)}
						</div>
					))}
				</List>
				{props.components?.Footer?.()}
			</div>
		);
	},
}));

describe("MessageFeed compound primitives", () => {
	it("composes virtual mechanics with an explicit feed layout", () => {
		render(
			<MessageFeed.Root>
				<MessageFeedLayout.Frame>
					<MessageFeedLayout.Viewport>
						<MessageFeedLayout.Virtualizer asChild>
							<MessageFeed.VirtualList
								items={[
									{ key: "first", text: "First" },
									{ key: "second", text: "Second" },
								]}
								getKey={(item) => item.key}
							>
								<MessageFeedLayout.List />
								{(item) => <div>{item.text}</div>}
								<MessageFeed.Footer>Footer</MessageFeed.Footer>
							</MessageFeed.VirtualList>
						</MessageFeedLayout.Virtualizer>
					</MessageFeedLayout.Viewport>
				</MessageFeedLayout.Frame>
			</MessageFeed.Root>,
		);

		expect(screen.getByText("First")).toBeTruthy();
		expect(screen.getByText("Second")).toBeTruthy();
		expect(screen.getByText("Footer")).toBeTruthy();
		expect(screen.getByTestId("virtualizer").className).toContain("pt-2");
		expect(document.querySelector("[data-message-feed-layout-part='list']")).toBeTruthy();
	});

	it("merges a chosen frame and state layout into caller-owned elements", () => {
		render(
			<MessageFeed.Root>
				<MessageFeedLayout.Frame asChild>
					<section aria-label="custom feed">
						<MessageFeedLayout.State>Empty</MessageFeedLayout.State>
					</section>
				</MessageFeedLayout.Frame>
			</MessageFeed.Root>,
		);

		const root = screen.getByRole("region", { name: "custom feed" });
		expect(root.getAttribute("data-message-feed-root")).toBe("");
		expect(root.querySelector("[data-message-feed-layout-part='state']")?.textContent).toBe(
			"Empty",
		);
	});

	it("requires the internal list layout instead of hiding it in virtual mechanics", () => {
		expect(() =>
			render(
				<MessageFeed.Root>
					<MessageFeed.VirtualList items={[]}>
						{() => null}
					</MessageFeed.VirtualList>
				</MessageFeed.Root>,
			),
		).toThrow("MessageFeed.VirtualList requires one MessageFeedLayout.List child");
	});
});

describe("Message compound primitives", () => {
	it("lets a scenario combine semantic abilities inside an explicit layout", () => {
		render(
			<Message.Root>
				<MessageLayout.Incoming>
					<MessageLayout.Header>
						<Message.Author>Reviewer</Message.Author>
						<Message.Status>Working</Message.Status>
					</MessageLayout.Header>
					<Message.Content>Review result</Message.Content>
					<MessageLayout.Footer asChild>
						<Message.Actions>Copy</Message.Actions>
					</MessageLayout.Footer>
				</MessageLayout.Incoming>
			</Message.Root>,
		);

		expect(screen.getByText("Reviewer")).toBeTruthy();
		expect(screen.getByText("Review result")).toBeTruthy();
		expect(screen.getByText("Copy").className).toContain("mt-2");
		expect(document.querySelector("[data-message-part='attachments']")).toBeNull();
	});

	it("lets the same layout position host different semantic content without a feature prop", () => {
		const { rerender } = render(
			<Message.Root>
				<MessageLayout.Incoming>
					<MessageLayout.Footer asChild>
						<Message.Actions>Approve</Message.Actions>
					</MessageLayout.Footer>
				</MessageLayout.Incoming>
			</Message.Root>,
		);

		expect(screen.getByText("Approve").getAttribute("data-message-part")).toBe("actions");
		rerender(
			<Message.Root>
				<MessageLayout.Incoming>
					<MessageLayout.Footer asChild>
						<Message.Cards>Tool result</Message.Cards>
					</MessageLayout.Footer>
				</MessageLayout.Incoming>
			</Message.Root>,
		);
		expect(screen.getByText("Tool result").getAttribute("data-message-part")).toBe("cards");
	});

	it("projects message state into a caller-owned layout host", () => {
		render(
			<Message.Root pending>
				<MessageLayout.Event asChild>
					<article aria-label="delegation event">
						<MessageVisual.EventBubble>Delegated</MessageVisual.EventBubble>
					</article>
				</MessageLayout.Event>
			</Message.Root>,
		);

		const root = screen.getByRole("article", { name: "delegation event" });
		expect(root.getAttribute("data-message-layout")).toBe("event");
		expect(root.getAttribute("data-pending")).toBe("true");
	});

	it("rejects a semantic part without its owning state boundary", () => {
		expect(() => render(<Message.Content>orphan</Message.Content>)).toThrow(
			"Message.Content must be used within Message.Root",
		);
	});

	it("rejects a positional part in the wrong layout recipe", () => {
		expect(() =>
			render(
				<Message.Root>
					<MessageLayout.Outgoing>
						<MessageLayout.Header>invalid</MessageLayout.Header>
					</MessageLayout.Outgoing>
				</Message.Root>,
			),
		).toThrow("MessageLayout.Header must be used within MessageLayout.Incoming");
	});
});
