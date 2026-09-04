// @vitest-environment jsdom

import {
	CopyButton,
	Message,
	MessageFeed,
	MessageFeedLayout,
	MessageLayout,
	MessageVisual,
} from "@vetta/theme-ui/chat";
import { Button } from "@shared/components/ui/button";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, HTMLAttributes, ReactNode } from "react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { MessageFeedNavigation } from "./MessageFeedNavigation";

vi.mock("@shared/shortcuts", () => ({ useShortcutScope: () => undefined }));

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
		expect(screen.getByTestId("virtualizer").className).toContain("min-h-0");
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

describe("MessageFeedNavigation compound primitives", () => {
	it("lets JSX mount and remove navigation capabilities independently", async () => {
		render(
			<MessageFeedNavigation.Root>
				<MessageFeedNavigation.Trigger asChild>
					<button type="button">Open outline</button>
				</MessageFeedNavigation.Trigger>
				<MessageFeedNavigation.Preview>Tick preview</MessageFeedNavigation.Preview>
				<MessageFeedNavigation.Content>
					<div>
						<label>
							Search
							<MessageFeedNavigation.Search />
						</label>
						<MessageFeedNavigation.Close asChild>
							<button type="button">Close outline</button>
						</MessageFeedNavigation.Close>
					</div>
				</MessageFeedNavigation.Content>
			</MessageFeedNavigation.Root>,
		);

		const trigger = screen.getByRole("button", { name: "Open outline" });
		expect(trigger.getAttribute("data-state")).toBe("closed");
		expect(screen.getByText("Tick preview")).toBeTruthy();
		expect(screen.queryByRole("textbox", { name: "Search" })).toBeNull();

		await userEvent.click(trigger);
		expect(trigger.getAttribute("data-state")).toBe("open");
		expect(screen.queryByText("Tick preview")).toBeNull();
		expect(screen.getByRole("textbox", { name: "Search" })).toBeTruthy();

		await userEvent.click(screen.getByRole("button", { name: "Close outline" }));
		expect(screen.queryByRole("textbox", { name: "Search" })).toBeNull();
	});

	it("fails early when a capability is mounted outside its Root", () => {
		expect(() => render(<MessageFeedNavigation.Search aria-label="orphan" />)).toThrow(
			"MessageFeedNavigation.Search must be used within MessageFeedNavigation.Root",
		);
	});
});

describe("Message compound primitives", () => {
	it("keeps real copy and custom actions functional when composed, reordered, or omitted", async () => {
		const user = userEvent.setup();
		const inspect = vi.fn();
		const { rerender } = render(
			<Message.Root>
				<MessageLayout.Incoming>
					<p>Response</p>
					<MessageLayout.Footer>
						<Button onClick={inspect}>Inspect</Button>
						<CopyButton getText={() => "Response"} labels={{ copy: "Copy", copied: "Copied" }} />
					</MessageLayout.Footer>
				</MessageLayout.Incoming>
			</Message.Root>,
		);
		expect(
			screen.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent),
		).toEqual(["Inspect", "Copy"]);
		await user.click(screen.getByRole("button", { name: "Inspect" }));
		expect(inspect).toHaveBeenCalledOnce();
		await user.click(screen.getByRole("button", { name: "Copy" }));
		expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
		expect(await navigator.clipboard.readText()).toBe("Response");

		rerender(
			<Message.Root>
				<MessageLayout.Incoming>
					<MessageLayout.Footer>
						<CopyButton getText={() => "Updated response"} labels={{ copy: "Copy", copied: "Copied" }} />
					</MessageLayout.Footer>
					<p>Updated response</p>
				</MessageLayout.Incoming>
			</Message.Root>,
		);
		expect(screen.queryByRole("button", { name: "Inspect" })).toBeNull();
		const copy = screen.getByRole("button", { name: "Copy" });
		expect(
			copy.compareDocumentPosition(screen.getByText("Updated response")) & Node.DOCUMENT_POSITION_FOLLOWING,
		).not.toBe(0);
		await user.click(copy);
		expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
		expect(await navigator.clipboard.readText()).toBe("Updated response");
	});

	it("projects author typography and merges refs and events into a caller-owned link without a Root", async () => {
		const user = userEvent.setup();
		const forwardedRef = createRef<HTMLAnchorElement>();
		const childRef = createRef<HTMLAnchorElement>();
		const events: string[] = [];
		const { container } = render(
			<Message.Author
				asChild
				ref={forwardedRef}
				className="custom-author"
				aria-label="Open reviewer"
				onClick={() => events.push("part")}
			>
				<a
					ref={childRef}
					href="#reviewer"
					className="profile-link"
					onClick={(event) => {
						event.preventDefault();
						events.push("host");
					}}
				>
					Reviewer
				</a>
			</Message.Author>,
		);
		const link = screen.getByRole("link", { name: "Open reviewer" });
		expect(container.firstElementChild).toBe(link);
		expect(link.tagName).toBe("A");
		expect(forwardedRef.current).toBe(link);
		expect(childRef.current).toBe(link);
		expect(link.className).toContain("font-semibold");
		expect(link.className).toContain("custom-author");
		expect(link.className).toContain("profile-link");
		await user.click(link);
		expect(events).toEqual(["host", "part"]);
	});

	it("combines semantic leaves with caller-owned content inside an explicit layout", () => {
		render(
			<Message.Root>
				<MessageLayout.Incoming>
					<MessageLayout.Header>
						<Message.Author>Reviewer</Message.Author>
						<Message.Status>Working</Message.Status>
					</MessageLayout.Header>
					<section>Review result</section>
					<MessageLayout.Footer asChild>
						<div>Copy</div>
					</MessageLayout.Footer>
				</MessageLayout.Incoming>
			</Message.Root>,
		);

		expect(screen.getByText("Reviewer").tagName).toBe("SPAN");
		expect(screen.getByText("Reviewer").className).toContain("font-semibold");
		expect(screen.getByText("Working").className).toContain("inline-flex");
		expect(screen.getByText("Review result")).toBeTruthy();
		expect(screen.getByText("Copy").className).toContain("mt-2");
	});

	it("lets the same layout position host arbitrary content without a feature prop", () => {
		const { rerender } = render(
			<Message.Root>
				<MessageLayout.Incoming>
					<MessageLayout.Footer asChild>
						<button type="button">Approve</button>
					</MessageLayout.Footer>
				</MessageLayout.Incoming>
			</Message.Root>,
		);

		expect(screen.getByRole("button", { name: "Approve" }).className).toContain("mt-2");
		rerender(
			<Message.Root>
				<MessageLayout.Incoming>
					<MessageLayout.Footer asChild>
						<aside>Tool result</aside>
					</MessageLayout.Footer>
				</MessageLayout.Incoming>
			</Message.Root>,
		);
		expect(screen.getByText("Tool result").tagName).toBe("ASIDE");
		expect(screen.getByText("Tool result").className).toContain("mt-2");
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

	it("rejects a state-consuming visual without its owning state boundary", () => {
		expect(() => render(<MessageVisual.OutgoingBubble>orphan</MessageVisual.OutgoingBubble>)).toThrow(
			"MessageVisual.OutgoingBubble must be used within Message.Root",
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
