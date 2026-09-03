// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createConversationUserMessage } from "@shared/conversation";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./useSkillTokenMeta", () => ({ useSkillTokenMeta: () => vi.fn() }));

const atoms = await import("@shared/store/atoms");
const { stagePendingSessionSend } = await import("../services/staged-new-session-send");
const { useUserMessageEditAction, useUserMessageHistoryActions } = await import("./useUserMessageActions");

describe("user-message actions Runtime readiness", () => {
	beforeEach(() => {
		const store = getDefaultStore();
		store.set(atoms.activeSessionAtom, null);
		store.set(atoms.pendingSessionCreationAtom, null);
		store.set(atoms.pendingSessionOpenAtom, null);
		store.set(atoms.pendingMessageEditAtom, null);
		store.set(atoms.chatMessagesAtom, []);
		store.set(atoms.inputValueAtom, "");
		store.set(atoms.attachedImagesAtom, []);
		store.set(atoms.mentionedFilesAtom, []);
		store.set(atoms.appshotAttachmentAtom, null);
		store.set(atoms.activeInputDraftKeyAtom, "C:/sessions/target.jsonl");
		atoms.openSessionFnRef.current = null;
	});

	it("edits an accepted deferred message immediately without waiting for Runtime", async () => {
		const store = getDefaultStore();
		store.set(atoms.pendingSessionOpenAtom, {
			cwd: "C:/repo",
			sessionPath: "C:/sessions/target.jsonl",
			interactionId: "open-1",
		});
		store.set(atoms.inputValueAtom, "edit me");
		const staged = stagePendingSessionSend(undefined, "send-1");
		expect(staged).not.toBeNull();
		if (!staged) return;

		const { result } = renderHook(() =>
			useUserMessageEditAction({
				message: staged.optimisticMessage,
				isLastUserMessage: true,
				enabled: true,
			}),
		);
		act(() => result.current.onEdit());

		await waitFor(() => expect(store.get(atoms.inputValueAtom)).toBe("edit me"));
		expect(store.get(atoms.chatMessagesAtom)).toEqual([]);
		expect(store.get(atoms.pendingSessionOpenAtom)?.interactionId).toBe("open-1");
	});

	it("accepts Fork immediately and runs it against the original target after readiness", async () => {
		const store = getDefaultStore();
		const forkSession = vi.fn(async () => ({ path: "C:/sessions/fork.jsonl" }));
		const openSession = vi.fn(async () => undefined);
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { session: { forkSession } },
		});
		atoms.openSessionFnRef.current = openSession;
		store.set(atoms.pendingSessionOpenAtom, {
			cwd: "C:/repo",
			sessionPath: "C:/sessions/target.jsonl",
			interactionId: "open-1",
		});
		const message = createConversationUserMessage({ id: "user-1", entryId: "entry-1", text: "fork me" });

		const { result } = renderHook(() =>
			useUserMessageHistoryActions({
				message,
				isStreaming: false,
				forkEnabled: true,
			}),
		);
		act(() => result.current.onFork());
		expect(forkSession).not.toHaveBeenCalled();

		act(() => {
			store.set(atoms.activeSessionAtom, {
				cwd: "C:/repo",
				sessionPath: "C:/sessions/target.jsonl",
				runtimeId: "runtime-target",
			});
			store.set(atoms.pendingSessionOpenAtom, null);
		});

		await waitFor(() => expect(forkSession).toHaveBeenCalledWith("runtime-target", "entry-1"));
		expect(openSession).toHaveBeenCalledWith("C:/repo", "C:/sessions/fork.jsonl");
	});
});
