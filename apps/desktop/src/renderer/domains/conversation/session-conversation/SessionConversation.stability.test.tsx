// @vitest-environment jsdom
import { createConversationAgentMessage, createConversationUserMessage } from "@shared/conversation";
import {
	activeSessionAtom,
	type ChatConversationItem,
	pendingSessionOpenAtom,
} from "@shared/store/atoms";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider, useAtomValue } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	bindConversationFeed,
	dispatchConversationFeed,
	resetConversationFeed,
} from "../services/conversation-feed-store";
import { SessionConversation } from "./SessionConversation";

const virtualizer = vi.hoisted(() => ({ mounts: 0 }));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../hooks/useSkillTokenMeta", () => ({ useSkillTokenMeta: () => () => undefined }));
// jsdom has no layout: replace only the external virtualizer and count how often the list mounts.
vi.mock("react-virtuoso", async () => {
	const { useEffect: useMountEffect } = await import("react");
	return {
		Virtuoso: ({
			data,
			itemContent,
		}: {
			data: readonly ChatConversationItem[];
			itemContent: (index: number, item: ChatConversationItem) => ReactNode;
		}) => {
			useMountEffect(() => {
				virtualizer.mounts += 1;
			}, []);
			return (
				<div>
					{data.map((item, index) => (
						<div key={item.renderKey ?? item.id}>{itemContent(index, item)}</div>
					))}
				</div>
			);
		},
	};
});

const B = { cwd: "/project", sessionPath: "/history/b.jsonl", runtimeId: "runtime-b" };

function turn(index: number): ChatConversationItem[] {
	return [
		createConversationUserMessage({ id: `u${index}`, entryId: `u${index}`, text: `question ${index}` }),
		createConversationAgentMessage({
			id: `a${index}`,
			entryId: `a${index}`,
			turnId: `t${index}`,
			text: `answer ${index}`,
			blocks: [{ type: "text", id: `text${index}`, text: `answer ${index}` }],
			phase: "completed",
		}),
	];
}

/** The chat view's identity rule: a pending open's target path, else the active session's path. */
function ChatIdentity() {
	const pending = useAtomValue(pendingSessionOpenAtom);
	const active = useAtomValue(activeSessionAtom);
	return (
		<SessionConversation
			sessionId={pending?.sessionPath ?? active?.sessionPath ?? null}
			workspace={{ id: "/project", cwd: "/project", runtimeIds: [] }}
		/>
	);
}

beforeEach(() => {
	virtualizer.mounts = 0;
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	Object.assign(window, {
		vetta: {
			messageAnnotations: { list: async () => [], ask: vi.fn(), cancel: vi.fn(), onChanged: () => () => {} },
			session: { listSandboxGrants: async () => [] },
			models: { get: async () => ({ providers: {} }), fetchRemote: async () => ({ providers: {} }) },
		},
	});
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("SessionConversation keeps its list mounted", () => {
	it("while an existing session opens: preview, Runtime identity, then full history", async () => {
		const store = createStore();
		render(
			<Provider store={store}>
				<ChatIdentity />
			</Provider>,
		);
		const history = Array.from({ length: 10 }, (_, index) => turn(index)).flat();

		await act(async () => {
			resetConversationFeed(store);
			store.set(pendingSessionOpenAtom, { cwd: B.cwd, sessionPath: B.sessionPath, interactionId: "open" });
			dispatchConversationFeed({ type: "history.loaded", items: history.slice(-4), revision: 1 }, store);
		});
		const mountsAfterPreview = virtualizer.mounts;
		const tail = screen.getByText("question 9");

		await act(async () => {
			bindConversationFeed(B.runtimeId, store);
			store.set(activeSessionAtom, B);
		});
		expect(virtualizer.mounts).toBe(mountsAfterPreview);
		expect(screen.getByText("question 9")).toBe(tail);

		await act(async () => {
			dispatchConversationFeed({ type: "feed.attached", runtimeId: B.runtimeId, items: history, revision: 2 }, store);
			store.set(pendingSessionOpenAtom, null);
		});
		expect(virtualizer.mounts).toBe(mountsAfterPreview);
		expect(screen.getByText("question 9")).toBe(tail);
	});

	it("while the first message of a new session gets its session", async () => {
		const store = createStore();
		render(
			<Provider store={store}>
				<ChatIdentity />
			</Provider>,
		);
		await act(async () => {
			dispatchConversationFeed(
				{ type: "user.sent", message: createConversationUserMessage({ id: "local-user", text: "first" }) },
				store,
			);
			dispatchConversationFeed({ type: "turn.pending", startedAt: 1 }, store);
		});
		const mounts = virtualizer.mounts;
		const bubble = screen.getByText("first");

		await act(async () => {
			bindConversationFeed(B.runtimeId, store);
			store.set(activeSessionAtom, B);
		});
		await act(async () => {
			dispatchConversationFeed(
				{
					type: "runtime.events",
					runtimeId: B.runtimeId,
					events: [
						{ type: "conversation.turn.started", turnId: "t1", timestamp: 2, sequence: 1 },
						{
							type: "conversation.message.appended",
							turnId: "t1",
							messageId: "local-user",
							message: { role: "user", content: "first", timestamp: 2 },
							timestamp: 2,
							sequence: 2,
						},
					] as never,
				},
				store,
			);
		});
		expect(virtualizer.mounts).toBe(mounts);
		expect(screen.getByText("first")).toBe(bubble);
	});

	it("while a message is sent in an open session", async () => {
		const store = createStore();
		store.set(activeSessionAtom, B);
		render(
			<Provider store={store}>
				<ChatIdentity />
			</Provider>,
		);
		await act(async () => {
			bindConversationFeed(B.runtimeId, store);
			dispatchConversationFeed(
				{ type: "feed.attached", runtimeId: B.runtimeId, items: [...turn(0), ...turn(1)], revision: 1 },
				store,
			);
		});
		const mounts = virtualizer.mounts;
		const earlier = screen.getByText("question 1");

		await act(async () => {
			dispatchConversationFeed(
				{
					type: "user.sent",
					runtimeId: B.runtimeId,
					message: createConversationUserMessage({ id: "local-user", text: "next" }),
				},
				store,
			);
			dispatchConversationFeed({ type: "turn.pending", startedAt: 1 }, store);
		});
		const bubble = screen.getByText("next");
		await act(async () => {
			dispatchConversationFeed(
				{
					type: "runtime.events",
					runtimeId: B.runtimeId,
					events: [
						{ type: "conversation.turn.started", turnId: "t2", timestamp: 2, sequence: 1 },
						{
							type: "conversation.message.appended",
							turnId: "t2",
							messageId: "local-user",
							message: { role: "user", content: "next", timestamp: 2 },
							timestamp: 2,
							sequence: 2,
						},
					] as never,
				},
				store,
			);
		});
		expect(virtualizer.mounts).toBe(mounts);
		expect(screen.getByText("question 1")).toBe(earlier);
		expect(screen.getByText("next")).toBe(bubble);
	});
});
