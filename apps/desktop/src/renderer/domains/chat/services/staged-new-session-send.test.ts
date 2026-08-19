// @vitest-environment jsdom

import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@shared/lib/perf-send", () => ({ perfSendMark: vi.fn() }));

const atoms = await import("@shared/store/atoms");
const { restoreStagedNewSessionSend, stageNewSessionSend } = await import("./staged-new-session-send");

describe("staged new-session send", () => {
	beforeEach(() => {
		const store = getDefaultStore();
		store.set(atoms.activeInputDraftKeyAtom, atoms.newSessionInputDraftKey("C:/workspace"));
		store.set(atoms.inputValueAtom, "  inspect this  ");
		store.set(atoms.attachedImagesAtom, []);
		store.set(atoms.mentionedFilesAtom, [{ path: "C:/workspace/readme.md", name: "readme.md", isDirectory: false }]);
		store.set(atoms.appshotAttachmentAtom, null);
		store.set(atoms.selectedModelAtom, "openai/test-model");
		store.set(atoms.chatMessagesAtom, []);
	});

	it("renders the first user bubble and clears the composer before a runtime exists", () => {
		const staged = stageNewSessionSend(undefined, "interaction-1");

		expect(staged).not.toBeNull();
		expect(staged?.rawText).toBe("inspect this");
		expect(staged?.optimisticMessage).toMatchObject({
			role: "user",
			text: "inspect this",
			model: { provider: "openai", id: "test-model" },
			attachments: [{ kind: "file", path: "C:/workspace/readme.md" }],
		});
		expect(getDefaultStore().get(atoms.chatMessagesAtom)).toEqual([staged?.optimisticMessage]);
		expect(getDefaultStore().get(atoms.inputValueAtom)).toBe("");
	});

	it("restores the captured draft after session creation fails", () => {
		const staged = stageNewSessionSend(undefined, "interaction-1");
		expect(staged).not.toBeNull();
		if (!staged) return;

		restoreStagedNewSessionSend(staged);

		expect(getDefaultStore().get(atoms.chatMessagesAtom)).toEqual([]);
		expect(getDefaultStore().get(atoms.inputValueAtom)).toBe("inspect this");
		expect(getDefaultStore().get(atoms.mentionedFilesAtom)).toEqual(staged.mentionedFiles);
	});
});
