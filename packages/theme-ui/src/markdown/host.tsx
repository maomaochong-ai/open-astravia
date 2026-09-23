import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/** Optional host capabilities. Renderers never import Electron, IPC or application state. */
export interface MarkdownHost {
	openHtml(source: string): Promise<() => void>;
	renderMermaid(source: string, theme: "light" | "dark"): Promise<string>;
	favicon(origin: string): Promise<string | null>;
	resolveImage(source: string): Promise<string>;
	copyImage(source: string): Promise<void>;
	saveImage(source: string): Promise<void>;
	openImage(source: string, name: string): void;
}
const MarkdownHostContext = createContext<MarkdownHost | undefined>(undefined);
export function MarkdownHostProvider({ host, children }: { host?: MarkdownHost; children: ReactNode }) {
	return <MarkdownHostContext.Provider value={host}>{children}</MarkdownHostContext.Provider>;
}
export function useMarkdownHost() { return useContext(MarkdownHostContext); }
