// @vitest-environment jsdom
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createConversationAgentMessage } from "@shared/conversation";
import { RendererMarkdownScope } from "@shared/components/RendererMarkdownScope";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantRenderingProvider } from "./AssistantRendering";
import { useAssistantMessageModel } from "../../hooks/useAssistantMessageModel";
import { ContentRenderingProvider } from "./ContentRendering";
import { SegmentRenderer } from "./MessageBlockSegments";
import { MessageExpansionScope, useExpansion } from "./expansionStore";

beforeEach(() =>
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	),
);
afterEach(() => vi.unstubAllGlobals());

describe("feed rendering boundaries", () => {
	it("keeps expansion through virtual unmounts, isolates siblings, and resets on feed changes", () => {
		function Toggle({ label }: { label: string }) {
			const [expanded, toggle] = useExpansion("same-key");
			return (
				<button type="button" onClick={toggle}>
					{label}: {expanded ? "open" : "closed"}
				</button>
			);
		}
		function Feeds({ show = true, scope = "a" }: { show?: boolean; scope?: string }) {
			return (
				<>
					<MessageExpansionScope scope={scope}>{show ? <Toggle label="A" /> : null}</MessageExpansionScope>
					<MessageExpansionScope scope="b">
						<Toggle label="B" />
					</MessageExpansionScope>
				</>
			);
		}
		const view = render(<Feeds />);
		fireEvent.click(screen.getByRole("button", { name: "A: closed" }));
		expect(screen.getByRole("button", { name: "B: closed" })).toBeTruthy();
		view.rerender(<Feeds show={false} />);
		view.rerender(<Feeds />);
		expect(screen.getByRole("button", { name: "A: open" })).toBeTruthy();
		view.rerender(<Feeds scope="new" />);
		expect(screen.getByRole("button", { name: "A: closed" })).toBeTruthy();
	});

	it("replaces a block in the real segment recipe and restores the default when the extension is removed", () => {
		const block = { type: "text" as const, id: "text", text: "**Original**" };
		const environment = {
			theme: "light" as const,
			labels: { copy: "Copy", copied: "Copied" },
			getFileIconClass: () => "",
			onOpenFile: () => undefined,
			onOpenUrl: () => undefined,
		};
		const segment = { type: "single" as const, block };
		const view = render(
			<RendererMarkdownScope value={environment}>
				<ContentRenderingProvider renderers={{ text: () => <aside>Replacement</aside> }}>
					<SegmentRenderer segment={segment} />
				</ContentRenderingProvider>
			</RendererMarkdownScope>,
		);
		expect(screen.getByText("Replacement")).toBeTruthy();
		expect(screen.queryByText("Original")).toBeNull();
		view.rerender(
			<RendererMarkdownScope value={environment}>
				<SegmentRenderer segment={segment} />
			</RendererMarkdownScope>,
		);
		expect(screen.getByText("Original").tagName).toBe("STRONG");
		expect(block.text).toBe("**Original**");
	});

	it("takes narration and prediction from its explicit scope, never from a different active feed", () => {
		const input = {
			message: createConversationAgentMessage({ id: "assistant", text: "Done", blocks: [] }),
			expanded: true,
			exportMode: false,
			isStreaming: false,
			isTailMessage: true,
		};
		const standalone = renderHook(() => useAssistantMessageModel(input));
		expect(standalone.result.current.isPredicting).toBe(false);
		expect(standalone.result.current.stagedNarration).toBe(true);
		const scoped = renderHook(() => useAssistantMessageModel(input), {
			wrapper: ({ children }) => (
				<AssistantRenderingProvider value={{ narration: "inline", predicting: true }}>
					{children}
				</AssistantRenderingProvider>
			),
		});
		expect(scoped.result.current.isPredicting).toBe(true);
		expect(scoped.result.current.stagedNarration).toBe(false);
		expect(standalone.result.current.isPredicting).toBe(false);
	});

	it("collapses team execution cards while keeping the leader's final summary visible", () => {
		const inspectBlock = {
			type: "tool_call" as const,
			toolCallId: "inspect",
			toolName: "read",
			args: {},
			status: "success" as const,
		};
		const delegateBlock = {
			type: "tool_call" as const,
			toolCallId: "delegate",
			toolName: "team_delegate_task",
			args: {},
			status: "success" as const,
		};
		const summaryBlock = { type: "text" as const, id: "summary", text: "负责人最终总结" };
		const message = {
			...createConversationAgentMessage({
				id: "leader-continuation",
				text: summaryBlock.text,
				blocks: [inspectBlock, delegateBlock, summaryBlock],
			}),
			toolCallPresentations: [{ toolCallId: delegateBlock.toolCallId, activities: [] }],
		};

		const model = renderHook(() =>
			useAssistantMessageModel({
				message,
				expanded: false,
				exportMode: false,
				isStreaming: false,
				isTailMessage: false,
			}),
		);

		expect(model.result.current.foldData?.processBlocks).toEqual([inspectBlock, delegateBlock]);
		expect(model.result.current.foldData?.answerBlocks).toEqual([summaryBlock]);
		expect(model.result.current.segments).toEqual([{ type: "single", block: summaryBlock }]);
	});
});
