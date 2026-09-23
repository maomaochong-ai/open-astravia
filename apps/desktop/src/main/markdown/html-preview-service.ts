import { randomUUID } from "node:crypto";
import type { BrowserWindow, WebContents } from "electron";
import { createMarkdownWindow, isolatedDocument, terminateMarkdownWindow } from "./isolated-window.js";

export class HtmlPreviewService {
	private readonly windows = new Map<string, BrowserWindow>();
	constructor(
		private readonly owner: WebContents,
		private readonly title: string,
	) {}
	open(source: string): string {
		if (source.length > 256_000 || this.windows.size >= 2) throw new Error("Markdown preview limit exceeded");
		const id = randomUUID();
		const window = createMarkdownWindow(this.owner, true);
		window.setTitle(this.title);
		window.on("page-title-updated", (event) => event.preventDefault());
		this.windows.set(id, window);
		const timer = setTimeout(() => this.close(id), 30_000);
		window.once("closed", () => {
			clearTimeout(timer);
			this.windows.delete(id);
		});
		void window.loadURL(isolatedDocument(source)).catch(() => this.close(id));
		return id;
	}
	close(id: string): void {
		const window = this.windows.get(id);
		if (window) terminateMarkdownWindow(window);
	}
	dispose(): void {
		for (const id of this.windows.keys()) this.close(id);
	}
}
