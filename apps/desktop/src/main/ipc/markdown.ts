import type { IpcMainInvokeEvent, WebContents } from "electron";
import { ipcMain } from "electron";
import { MARKDOWN_CHANNELS } from "../../shared/markdown-ipc.js";
import { mainT } from "../i18n/index.js";
import { FaviconService } from "../markdown/favicon-service.js";
import { HtmlPreviewService } from "../markdown/html-preview-service.js";
import { readMarkdownImage } from "../markdown/image-resource.js";
import { MermaidService } from "../markdown/mermaid-service.js";

export function registerMarkdownIpc(owner: WebContents): () => void {
	const html = new HtmlPreviewService(owner, mainT("markdown.previewTitle"));
	const mermaid = new MermaidService(owner);
	const icons = new FaviconService();
	const input = (event: IpcMainInvokeEvent, value: unknown, max: number): string => {
		if (event.sender !== owner || event.senderFrame !== owner.mainFrame) throw new Error("Untrusted Markdown caller");
		if (typeof value !== "string" || value.length > max) throw new Error("Invalid Markdown input");
		return value;
	};
	ipcMain.handle(MARKDOWN_CHANNELS.openHtml, (event, source: unknown) => html.open(input(event, source, 256_000)));
	ipcMain.handle(MARKDOWN_CHANNELS.closeHtml, (event, id: unknown) => html.close(input(event, id, 128)));
	ipcMain.handle(MARKDOWN_CHANNELS.renderMermaid, (event, source: unknown, theme: unknown) => {
		const validated = input(event, source, 12_000);
		if (theme !== "light" && theme !== "dark") throw new Error("Invalid diagram theme");
		return mermaid.render(validated, theme);
	});
	ipcMain.handle(MARKDOWN_CHANNELS.favicon, (event, origin: unknown) => icons.resolve(input(event, origin, 2048)));
	ipcMain.handle(MARKDOWN_CHANNELS.imageData, (event, url: unknown) => readMarkdownImage(input(event, url, 8192)));
	return () => {
		for (const channel of Object.values(MARKDOWN_CHANNELS)) ipcMain.removeHandler(channel);
		html.dispose();
		mermaid.dispose();
		icons.dispose();
	};
}
