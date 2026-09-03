// @vitest-environment jsdom

import { activeSessionAtom, pendingSessionCreationAtom, pendingSessionOpenAtom } from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import { getSessionRuntimeWhenReady } from "./session-runtime-readiness";

describe("session runtime readiness", () => {
	beforeEach(() => {
		const store = getDefaultStore();
		store.set(activeSessionAtom, null);
		store.set(pendingSessionCreationAtom, null);
		store.set(pendingSessionOpenAtom, null);
	});

	it("waits for the exact pending transition before releasing an operation", async () => {
		const store = getDefaultStore();
		store.set(pendingSessionOpenAtom, {
			cwd: "C:/repo",
			sessionPath: "C:/repo/session.jsonl",
			interactionId: "open-1",
		});
		const result = getSessionRuntimeWhenReady();
		const session = {
			cwd: "C:/repo",
			sessionPath: "C:/repo/session.jsonl",
			runtimeId: "runtime-1",
		};

		store.set(activeSessionAtom, session);
		let resolved = false;
		void result.then(() => {
			resolved = true;
		});
		await Promise.resolve();
		expect(resolved).toBe(false);

		store.set(pendingSessionOpenAtom, null);
		await expect(result).resolves.toEqual(session);
	});

	it("cancels an old operation instead of redirecting it to a superseding session", async () => {
		const store = getDefaultStore();
		store.set(pendingSessionOpenAtom, {
			cwd: "C:/repo",
			sessionPath: "C:/repo/first.jsonl",
			interactionId: "open-1",
		});
		const result = getSessionRuntimeWhenReady();

		store.set(pendingSessionOpenAtom, {
			cwd: "C:/repo",
			sessionPath: "C:/repo/second.jsonl",
			interactionId: "open-2",
		});

		await expect(result).resolves.toBeNull();
	});
});
