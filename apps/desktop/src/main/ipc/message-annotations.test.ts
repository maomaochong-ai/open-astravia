import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcRenderer, WebContents } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMessageAnnotationsApi } from "../../preload/apis/message-annotations.js";
import { ANNOTATION_CHANNELS } from "../../shared/message-annotations.js";
import { MessageAnnotationService } from "../message-annotations/service.js";
import { registerMessageAnnotationsIpc } from "./message-annotations.js";

const bridge = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>() }));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
			bridge.handlers.set(channel, handler),
		removeHandler: (channel: string) => bridge.handlers.delete(channel),
	},
}));

describe("annotation preload/main contract", () => {
	let directory: string | undefined;
	let teardown: (() => void) | undefined;
	afterEach(async () => {
		teardown?.();
		if (directory) await rm(directory, { recursive: true, force: true });
		bridge.handlers.clear();
	});

	it("runs the public API through registered handlers, saves results, scopes events and removes subscriptions", async () => {
		directory = await mkdtemp(join(tmpdir(), "vetta-note-ipc-"));
		const path = join(directory, "main.jsonl");
		await writeFile(path, "main");
		const complete = vi.fn(async () => ({
			answer: "Explanation",
			stopReason: "stop" as const,
			usage: { input: 1, output: 1, totalTokens: 2 },
		}));
		const service = new MessageAnnotationService({
			source: (id) => {
				if (id !== "runtime") throw new Error("Unknown session");
				return {
					path,
					modelKey: "test/model",
					history: [
						{ type: "message", entryId: "user", message: { role: "user", content: "Question", timestamp: 1 } },
					],
				};
			},
			complete,
		});
		const eventListeners = new Map<string, (event: unknown, value: unknown) => void>();
		teardown = registerMessageAnnotationsIpc(
			{
				isDestroyed: () => false,
				send: (channel: string, value: unknown) => eventListeners.get(channel)?.({}, value),
			} as unknown as WebContents,
			service,
		);
		const api = createMessageAnnotationsApi({
			invoke: async (channel: string, ...args: unknown[]) => bridge.handlers.get(channel)?.({}, ...args),
			on: (channel: string, listener: (event: unknown, value: unknown) => void) =>
				eventListeners.set(channel, listener),
			removeListener: (channel: string) => eventListeners.delete(channel),
		} as unknown as IpcRenderer).messageAnnotations;
		const changed = vi.fn();
		const unsubscribe = api.onChanged(changed);
		const input = { id: randomUUID(), entryId: "user", quote: "Question", question: "Explain?" };
		expect(await api.list("runtime")).toEqual([]);
		await expect(api.ask("runtime", { ...input, id: "../invalid" })).rejects.toThrow();
		await expect(api.ask("runtime", { ...input, question: " " })).rejects.toThrow();
		await expect(api.list("missing")).rejects.toThrow("Unknown session");
		expect(complete).not.toHaveBeenCalled();
		const answer = await api.ask("runtime", input);
		expect(answer.turns[0].answer).toBe("Explanation");
		expect(changed).toHaveBeenLastCalledWith({ sessionPath: path, annotation: answer });
		expect(await api.list("runtime")).toEqual([answer]);
		await api.cancel("runtime", input.id);
		unsubscribe();
		expect(eventListeners.has(ANNOTATION_CHANNELS.CHANGED)).toBe(false);
		teardown();
		expect(bridge.handlers.size).toBe(0);
	});
});
