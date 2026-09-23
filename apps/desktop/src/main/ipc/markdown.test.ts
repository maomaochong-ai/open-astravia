import type { IpcRenderer, WebContents } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { createMarkdownApi } from "../../preload/apis/markdown.js";
import { MARKDOWN_CHANNELS } from "../../shared/markdown-ipc.js";
import { registerMarkdownIpc } from "./markdown.js";

const bridge = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => bridge.handlers.set(channel, handler),
		removeHandler: (channel: string) => bridge.handlers.delete(channel),
	},
	BrowserWindow: class {},
}));
vi.mock("../i18n/index.js", () => ({ mainT: () => "Preview" }));
afterEach(() => bridge.handlers.clear());

it("routes the preload contract to Main and rejects foreign frames, malformed input and excessive source", async () => {
	const owner = { mainFrame: {}, isDestroyed: () => false } as unknown as WebContents;
	const event = { sender: owner, senderFrame: owner.mainFrame };
	const dispose = registerMarkdownIpc(owner);
	const ipc = {
		invoke: (channel: string, ...args: unknown[]) =>
			Promise.resolve().then(() => bridge.handlers.get(channel)?.(event, ...args)),
	} as IpcRenderer;
	const { markdown } = createMarkdownApi(ipc);
	await expect(markdown.favicon("file:///private")).resolves.toBeNull();
	await expect(markdown.closeHtml("missing-id")).resolves.toBeUndefined();
	await expect(markdown.openHtml("x".repeat(256_001))).rejects.toThrow("Invalid Markdown input");
	await expect(markdown.renderMermaid("x".repeat(12_001), "light")).rejects.toThrow("Invalid Markdown input");
	const handler = bridge.handlers.get(MARKDOWN_CHANNELS.openHtml);
	expect(() => handler?.({ ...event, senderFrame: {} }, "<script>1</script>")).toThrow("Untrusted");
	expect(() => handler?.({ ...event, sender: {} }, "<script>1</script>")).toThrow("Untrusted");
	expect(() => handler?.(event, { source: "html" })).toThrow("Invalid");
	dispose();
	expect(bridge.handlers.size).toBe(0);
});
