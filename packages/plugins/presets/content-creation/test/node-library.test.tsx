import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CONTENT_NODE_DEFINITIONS } from "../src/node/definitions";
import { EmptyCanvasStarter, NodeDefinitionGrid, NodeLibrary } from "../src/canvas/NodeLibrary";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ locale: "en", t: (key: string) => key }),
}));

describe("node creation surfaces", () => {
	it("renders every registered node in the creation grid", () => {
		const markup = renderToStaticMarkup(
			<NodeDefinitionGrid definitions={CONTENT_NODE_DEFINITIONS} onSelect={() => undefined} />,
		);

		for (const definition of CONTENT_NODE_DEFINITIONS) {
			expect(markup).toContain(`node.kind.${definition.kind}`);
			expect(markup).toContain(definition.descriptionKey);
		}
		// Icon chips stay monochrome; no per-kind rainbow backgrounds.
		expect(markup).not.toMatch(/bg-sky-|bg-amber-|bg-emerald-|text-sky-|text-amber-|text-emerald-/);
		expect(markup).toContain("bg-muted/80");
	});

	it("offers prompt, asset, image, and video nodes on an empty canvas", () => {
		const markup = renderToStaticMarkup(<EmptyCanvasStarter onAdd={() => undefined} />);

		expect(markup).toContain("graph.empty.title");
		expect(markup).toContain("graph.empty.description");
		expect(markup).toContain("node.kind.prompt");
		expect(markup).toContain("node.kind.asset");
		expect(markup).toContain("node.kind.image-generator");
		expect(markup).toContain("node.kind.video-generator");
		expect(markup).toContain("graph.empty.hint.prompt");
		expect(markup).toContain("graph.empty.hint.asset");
		expect(markup).toContain("graph.empty.hint.image-generator");
		expect(markup).toContain("graph.empty.hint.video-generator");
		// Open header + glass surface: no nested card chrome or icon chips.
		expect(markup).not.toContain("node.description.prompt");
		expect(markup).not.toContain("icon-[lucide--sparkles]");
		expect(markup).not.toContain("bg-muted/80");
		expect(markup).not.toMatch(/bg-sky-|bg-amber-|bg-emerald-|text-sky-|text-amber-|text-emerald-/);
		// Create-first order: image → video → prompt → asset.
		const imageAt = markup.indexOf("node.kind.image-generator");
		const videoAt = markup.indexOf("node.kind.video-generator");
		const promptAt = markup.indexOf("node.kind.prompt");
		const assetAt = markup.indexOf("node.kind.asset");
		expect(imageAt).toBeGreaterThan(-1);
		expect(videoAt).toBeGreaterThan(imageAt);
		expect(promptAt).toBeGreaterThan(videoAt);
		expect(assetAt).toBeGreaterThan(promptAt);
		expect(markup.match(/<button/g)).toHaveLength(4);
	});

	it("renders mutually exclusive select and pan tools in the canvas dock", () => {
		const markup = renderToStaticMarkup(
			<NodeLibrary activeTool="pan" onAdd={() => undefined} onToolChange={() => undefined} />,
		);

		expect(markup).toContain("canvas.tool.select");
		expect(markup).toContain("canvas.tool.pan");
		expect(markup).toContain("icon-[lucide--mouse-pointer-2]");
		expect(markup).toContain("icon-[lucide--hand]");
		expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
		expect(markup.match(/aria-pressed="false"/g)).toHaveLength(1);
	});
});
