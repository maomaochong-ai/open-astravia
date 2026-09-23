// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RendererMarkdownScope } from "@shared/components/RendererMarkdownScope";
import { activeSessionAtom, inputValueAtom, pendingScrollToEntryAtom } from "@shared/store/atoms";
import { AnnotationScope } from "./AnnotationScope";
import { AnnotationMessageMenu } from "./AnnotationMenus";
import { SessionSelection } from "../message-list/SessionSelection";
import { SessionMessageList } from "../SessionMessageList";
import { ChatHeaderActionsView } from "../chat-view/ChatHeaderActionsView";
import type { ReactNode } from "react";
import type { ChatConversationItem } from "@shared/store/atoms";
import type {
	AnnotationChanged,
	MessageAnnotation,
	MessageAnnotationsApi,
} from "../../../../../shared/message-annotations";
import { annotationAskSchema } from "../../../../../shared/message-annotations";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// jsdom has no layout: replace only the external virtualizer, preserving the real feed and rows.
vi.mock("react-virtuoso", () => ({
	Virtuoso: ({
		data,
		itemContent,
	}: {
		data: readonly ChatConversationItem[];
		itemContent: (index: number, item: ChatConversationItem) => ReactNode;
	}) => (
		<div>
			{data.map((item, index) => (
				<div key={item.id}>{itemContent(index, item)}</div>
			))}
		</div>
	),
}));
const session = { cwd: "/project", sessionPath: "/history/session.jsonl", runtimeId: "runtime" };
const message = {
	id: "reply",
	entryId: "reply",
	turnId: "turn",
	authorId: "assistant",
	kind: "agent" as const,
	role: "assistant" as const,
	phase: "completed" as const,
	text: "A queue preserves order",
	blocks: [],
};

describe("Q&A note interaction", () => {
	let saved: MessageAnnotation[];
	let listeners: Set<(event: AnnotationChanged) => void>;
	let api: MessageAnnotationsApi;
	beforeEach(() => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		saved = [];
		listeners = new Set();
		api = {
			list: vi.fn(async () => structuredClone(saved)),
			ask: vi.fn(async (_runtimeId, raw) => {
				const input = annotationAskSchema.parse(raw);
				const note = saved.find((item) => item.id === input.id) ?? {
					id: input.id,
					entryId: input.entryId,
					quote: input.quote,
					createdAt: 1,
					turns: [],
				};
				note.turns.push({
					question: input.question,
					answer: `Answer: ${input.question}`,
					status: "completed",
					modelKey: "test/model",
				});
				saved = [note];
				for (const listener of listeners)
					listener({ sessionPath: session.sessionPath, annotation: structuredClone(note) });
				return structuredClone(note);
			}),
			cancel: vi.fn(async () => {}),
			onChanged: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		};
		Object.assign(window, {
			vetta: {
				messageAnnotations: api,
				session: { listSandboxGrants: async () => [] },
				models: { get: async () => ({ providers: {} }), fetchRemote: async () => ({ providers: {} }) },
			},
		});
	});
	afterEach(() => {
		cleanup();
		window.getSelection()?.removeAllRanges();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	function mount(feedSessionPath?: string) {
		const store = createStore();
		store.set(activeSessionAtom, session);
		store.set(inputValueAtom, "Main draft");
		const view = render(
			<Provider store={store}>
				<RendererMarkdownScope
					value={{
						theme: "dark",
						labels: { copy: "Copy", copied: "Copied" },
						getFileIconClass: () => "",
						onOpenFile: () => {},
						onOpenUrl: () => {},
					}}
				>
					{feedSessionPath ? (
						<SessionMessageList
							messages={[message]}
							isStreaming={false}
							sessionId={feedSessionPath}
							workspace={{ id: session.cwd, cwd: session.cwd, runtimeIds: [session.runtimeId] }}
						/>
					) : (
						<AnnotationScope session={session} sourceEntryIds={["reply"]}>
							<SessionSelection>
								<div data-entry-id="reply">
									<p>{message.text}</p>
									<AnnotationMessageMenu message={message} />
								</div>
							</SessionSelection>
						</AnnotationScope>
					)}
				</RendererMarkdownScope>
			</Provider>,
		);
		return { ...view, store };
	}
	async function askFromMenu(user: ReturnType<typeof userEvent.setup>) {
		await user.click(screen.getByRole("button", { name: "annotations.messageMenu" }));
		await user.click(screen.getByRole("menuitem", { name: "annotations.ask" }));
		return screen.findByRole("dialog", { name: "annotations.title" });
	}

	it("keeps ordinary header actions without a persistent annotation menu", () => {
		const store = createStore();
		store.set(activeSessionAtom, session);
		render(
			<Provider store={store}>
				<ChatHeaderActionsView
					actions={{
						finishExport: vi.fn(),
						openExport: vi.fn(),
						togglePanel: vi.fn(),
						toggleBottomPanel: vi.fn(),
						openTerminal: vi.fn(),
						togglePin: vi.fn(async () => {}),
					}}
					model={{
						exportDisabled: false,
						exporting: false,
						exportTitle: "Export",
						panelOpen: false,
						panelTitle: "Panel",
						bottomPanelOpen: false,
						bottomPanelTitle: "Bottom panel",
						terminalAvailable: true,
						terminalFocused: false,
						terminalTitle: "Terminal",
						pinTitle: "Pin",
						pinned: false,
					}}
				/>
			</Provider>,
		);
		expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "annotations.conversationMenu" })).toBeNull();
		expect(screen.queryByRole("button", { name: "annotations.messageMenu" })).toBeNull();
	});

	it("asks from selected text in the real session feed whose identity is a session path, not a runtime ID", async () => {
		const user = userEvent.setup();
		const view = mount(session.sessionPath);
		expect(screen.getByRole("button", { name: "annotations.messageMenu" })).toBeTruthy();
		const text = await screen.findByText(message.text);
		const range = document.createRange();
		range.selectNodeContents(text);
		window.getSelection()?.addRange(range);
		fireEvent.contextMenu(text, { clientX: 50, clientY: 60 });
		expect(screen.getByRole("button", { name: "messageList.selectionContextMenu.copy" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "annotations.ask" }));
		await user.type(await screen.findByLabelText("annotations.question"), "Explain the queue");
		await user.click(screen.getByRole("button", { name: "annotations.send" }));
		await screen.findByText("Answer: Explain the queue");
		expect(saved[0]).toMatchObject({ entryId: message.entryId, quote: message.text });
		expect(vi.mocked(api.ask).mock.calls[0][0]).toBe(session.runtimeId);
		expect(view.store.get(inputValueAtom)).toBe("Main draft");
		await user.click(screen.getByRole("button", { name: "annotations.close" }));
		await user.click(screen.getByRole("button", { name: "annotations.messageMenu" }));
		await user.click(screen.getByRole("menuitem", { name: "annotations.history" }));
		await user.click(await screen.findByRole("button", { name: /Explain the queue/ }));
		await screen.findByText("Answer: Explain the queue");
	});

	it.each(["/history/another.jsonl", session.runtimeId])(
		"does not attach the active runtime to a mismatched feed %s",
		async (path) => {
			mount(path);
			const text = await screen.findByText(message.text);
			const range = document.createRange();
			range.selectNodeContents(text);
			window.getSelection()?.addRange(range);
			fireEvent.contextMenu(text, { clientX: 50, clientY: 60 });
			expect(screen.getByRole("button", { name: "messageList.selectionContextMenu.copy" })).toBeTruthy();
			expect(screen.queryByRole("button", { name: "annotations.ask" })).toBeNull();
			expect(screen.queryByRole("button", { name: "annotations.messageMenu" })).toBeNull();
			expect(api.list).not.toHaveBeenCalled();
		},
	);

	it("opens from the message menu, asks, closes, restores and follows up without touching the main draft", async () => {
		const user = userEvent.setup();
		const view = mount();
		expect(screen.queryByRole("dialog")).toBeNull();
		await askFromMenu(user);
		await user.type(screen.getByLabelText("annotations.question"), "Why?");
		await user.click(screen.getByRole("button", { name: "annotations.send" }));
		await screen.findByText("Answer: Why?");
		await user.click(screen.getByRole("button", { name: "annotations.close" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		view.unmount();
		const restored = mount();
		await user.click(await screen.findByRole("button", { name: "annotations.saved" }));
		await screen.findByText("Answer: Why?");
		await user.type(screen.getByLabelText("annotations.question"), "Example?");
		await user.click(screen.getByRole("button", { name: "annotations.send" }));
		await screen.findByText("Answer: Example?");
		expect(saved[0].turns).toHaveLength(2);
		expect(restored.store.get(inputValueAtom)).toBe("Main draft");
		await user.click(screen.getByRole("button", { name: "annotations.source" }));
		expect(restored.store.get(pendingScrollToEntryAtom)).toEqual({ entryId: "reply" });
	});

	it("opens from selected text and retains the original copy/add-to-input actions", async () => {
		const user = userEvent.setup();
		mount();
		const text = screen.getByText(message.text);
		const range = document.createRange();
		range.selectNodeContents(text);
		window.getSelection()?.addRange(range);
		fireEvent.contextMenu(text, { clientX: 50, clientY: 60 });
		expect(screen.getByRole("button", { name: "messageList.selectionContextMenu.copy" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "messageList.selectionContextMenu.addToInput" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "annotations.ask" }));
		const panel = await screen.findByRole("dialog");
		expect(within(panel).getByText(message.text)).toBeTruthy();
		await user.type(screen.getByLabelText("annotations.question"), "Explain");
		await user.click(screen.getByRole("button", { name: "annotations.send" }));
		await screen.findByText("Answer: Explain");
		expect(saved[0]).toMatchObject({ entryId: "reply", quote: message.text });
	});

	it("keeps drafts after an IPC failure and finds saved answers through the message menu", async () => {
		const user = userEvent.setup();
		mount();
		vi.mocked(api.ask).mockRejectedValueOnce(new Error("offline"));
		await askFromMenu(user);
		await user.type(screen.getByLabelText("annotations.question"), "Why?");
		await user.click(screen.getByRole("button", { name: "annotations.send" }));
		await screen.findByRole("alert");
		expect((screen.getByLabelText("annotations.question") as HTMLTextAreaElement).value).toBe("Why?");
		await user.click(screen.getByRole("button", { name: "annotations.send" }));
		await screen.findByText("Answer: Why?");
		await user.click(screen.getByRole("button", { name: "annotations.close" }));
		await user.click(screen.getByRole("button", { name: "annotations.messageMenu" }));
		await user.click(screen.getByRole("menuitem", { name: "annotations.history" }));
		await user.type(await screen.findByRole("searchbox"), "Why");
		await user.click(screen.getByRole("button", { name: /Why\?/ }));
		await screen.findByText("Answer: Why?");
	});

	it("shows the panel and pending state before paint-gated work; cancelling before dispatch avoids a model call", async () => {
		const user = userEvent.setup();
		mount();
		await waitFor(() => expect(api.list).toHaveBeenCalled());
		const callbacks: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			callbacks.push(callback);
			return callbacks.length;
		});
		await askFromMenu(user);
		await user.type(screen.getByLabelText("annotations.question"), "Why?");
		await user.click(screen.getByRole("button", { name: "annotations.send" }));
		expect(screen.getByRole("status").textContent).toBe("annotations.answering");
		await user.click(screen.getByRole("button", { name: "annotations.cancel" }));
		await act(async () => {
			while (callbacks.length) callbacks.shift()?.(0);
		});
		expect(api.ask).not.toHaveBeenCalled();
	});

	it("closes with Escape, restores focus, and retains the unsubmitted draft", async () => {
		const user = userEvent.setup();
		mount();
		await askFromMenu(user);
		expect(document.activeElement).toBe(screen.getByLabelText("annotations.question"));
		await user.type(screen.getByLabelText("annotations.question"), "Unsaved draft");
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "annotations.messageMenu" }));
		await askFromMenu(user);
		expect((screen.getByLabelText("annotations.question") as HTMLTextAreaElement).value).toBe("Unsaved draft");
	});

	it("keeps answering after close, ignores other-session updates and restores the saved result", async () => {
		const user = userEvent.setup();
		let finish!: (value: MessageAnnotation) => void;
		vi.mocked(api.ask).mockImplementation(async (_runtime, input) => {
			const note: MessageAnnotation = {
				id: input.id,
				entryId: input.entryId,
				quote: input.quote,
				createdAt: 1,
				turns: [{ question: input.question, answer: "", status: "pending", modelKey: "test/model" }],
			};
			for (const listener of listeners) listener({ sessionPath: session.sessionPath, annotation: note });
			return new Promise((resolve) => {
				finish = resolve;
			});
		});
		mount();
		await askFromMenu(user);
		await user.type(screen.getByLabelText("annotations.question"), "Why?");
		await user.click(screen.getByRole("button", { name: "annotations.send" }));
		await waitFor(() => expect(api.ask).toHaveBeenCalled());
		const input = vi.mocked(api.ask).mock.calls[0][1];
		await user.click(screen.getByRole("button", { name: "annotations.close" }));
		const note: MessageAnnotation = {
			id: input.id,
			entryId: "reply",
			quote: message.text,
			createdAt: 1,
			turns: [{ question: "Why?", answer: "Saved while closed", status: "completed", modelKey: "test/model" }],
		};
		await act(async () => {
			for (const listener of listeners)
				listener({ sessionPath: "/other/session.jsonl", annotation: { ...note, id: crypto.randomUUID() } });
			finish(note);
		});
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(api.cancel).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "annotations.saved" }));
		await screen.findByText("Saved while closed");
		await user.click(screen.getByRole("button", { name: "annotations.history" }));
		expect(screen.getAllByRole("button", { name: /Why\?/ })).toHaveLength(1);
	});
});
