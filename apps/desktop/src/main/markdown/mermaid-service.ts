import type { WebContents } from "electron";
import { createMarkdownWindow, isolatedDocument, terminateMarkdownWindow } from "./isolated-window.js";

/** Serial, bounded jobs; neither parser nor layout executes in the chat renderer. */
export class MermaidService {
	private tail: Promise<unknown> = Promise.resolve();
	private pending = 0;
	private disposed = false;
	private cancel: (() => void) | undefined;
	private readonly cache = new Map<string, string>();
	private bytes = 0;
	constructor(private readonly owner: WebContents) {}
	render(source: string, theme: "light" | "dark"): Promise<string> {
		if (this.disposed || source.length > 12_000 || this.pending >= 8)
			return Promise.reject(new Error("Diagram limit exceeded"));
		const key = `${theme}:${source}`;
		const cached = this.cache.get(key);
		if (cached) return Promise.resolve(cached);
		this.pending++;
		const job = this.tail
			.catch(() => {})
			.then(async () => {
				if (this.disposed || this.owner.isDestroyed()) throw new Error("Diagram owner closed");
				const duplicate = this.cache.get(key);
				if (duplicate) return duplicate;
				const svg = await this.run(source, theme);
				this.cache.set(key, svg);
				this.bytes += key.length + svg.length;
				while (this.cache.size > 32 || this.bytes > 2_000_000) {
					const oldest = this.cache.keys().next().value;
					if (oldest === undefined) break;
					this.bytes -= oldest.length + (this.cache.get(oldest)?.length ?? 0);
					this.cache.delete(oldest);
				}
				return svg;
			})
			.finally(() => {
				this.pending--;
			});
		this.tail = job;
		return job;
	}
	private async run(source: string, theme: "light" | "dark"): Promise<string> {
		const { default: script } = await import("mermaid/dist/mermaid.min.js?raw");
		if (this.disposed) throw new Error("Diagram owner closed");
		const window = createMarkdownWindow(this.owner, false);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const stopped = new Promise<never>((_resolve, reject) => {
			this.cancel = () => reject(new Error("Diagram rendering stopped"));
			window.once("closed", this.cancel);
			timer = setTimeout(this.cancel, 8_000);
		});
		try {
			const render = async (): Promise<unknown> => {
				await window.loadURL(isolatedDocument("<body></body>"));
				// The bundle's completion value contains functions and cannot cross Electron's clone boundary.
				await window.webContents.executeJavaScript(`${script}\n;void 0;`);
				return window.webContents.executeJavaScript(`(async () => {
					mermaid.initialize({startOnLoad:false,securityLevel:'strict',maxTextSize:12000,maxEdges:200,theme:${JSON.stringify(theme === "dark" ? "dark" : "default")},htmlLabels:false,flowchart:{htmlLabels:false},suppressErrorRendering:true});
					return (await mermaid.render('diagram', ${JSON.stringify(source)})).svg;
				})()`);
			};
			const svg = await Promise.race([render(), stopped]);
			if (typeof svg !== "string" || svg.length > 256_000) throw new Error("Diagram output limit exceeded");
			return svg;
		} finally {
			clearTimeout(timer);
			this.cancel = undefined;
			terminateMarkdownWindow(window);
		}
	}
	dispose(): void {
		this.disposed = true;
		this.cancel?.();
		this.cache.clear();
		this.bytes = 0;
	}
}
