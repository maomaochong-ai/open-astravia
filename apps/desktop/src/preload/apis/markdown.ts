import type { IpcRenderer } from "electron";
import { MARKDOWN_CHANNELS } from "../../shared/markdown-ipc.js";
import type { DesktopApi } from "../api.js";

export function createMarkdownApi(ipc: IpcRenderer): Pick<DesktopApi, "markdown"> {
	return {
		markdown: {
			openHtml: (source) => ipc.invoke(MARKDOWN_CHANNELS.openHtml, source),
			closeHtml: (id) => ipc.invoke(MARKDOWN_CHANNELS.closeHtml, id),
			renderMermaid: (source, theme) => ipc.invoke(MARKDOWN_CHANNELS.renderMermaid, source, theme),
			favicon: (origin) => ipc.invoke(MARKDOWN_CHANNELS.favicon, origin),
			imageData: (url) => ipc.invoke(MARKDOWN_CHANNELS.imageData, url),
		},
	};
}
