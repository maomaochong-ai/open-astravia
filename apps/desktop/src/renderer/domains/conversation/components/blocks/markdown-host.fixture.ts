import type { MarkdownHost } from "@vetta-org/theme-ui/markdown";
import { vi } from "vitest";

export function createMarkdownHostFixture() {
	const close = vi.fn();
	const host = {
		openHtml: vi.fn(async () => close),
		renderMermaid: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"><text>Rendered</text></svg>'),
		favicon: vi.fn(async () => null),
		resolveImage: vi.fn(async (src: string) => src),
		copyImage: vi.fn(async () => {}),
		saveImage: vi.fn(async () => {}),
		openImage: vi.fn(),
	} satisfies MarkdownHost;
	return { host, close };
}
