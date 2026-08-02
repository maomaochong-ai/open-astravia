import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CONTENT_NODE_DEFINITIONS } from "../src/domain/node-definitions";
import { EmptyCanvasStarter, NodeDefinitionGrid } from "../src/components/NodeLibrary";

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
	});

	it("offers the three primary creation choices on an empty canvas", () => {
		const markup = renderToStaticMarkup(<EmptyCanvasStarter onAdd={() => undefined} />);

		expect(markup).toContain("graph.empty.title");
		expect(markup).toContain("node.kind.prompt");
		expect(markup).toContain("node.kind.image-generator");
		expect(markup).toContain("node.kind.video-generator");
		expect(markup.match(/<button/g)).toHaveLength(3);
	});
});
