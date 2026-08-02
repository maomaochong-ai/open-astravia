import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ContentNodeSurface } from "../src/components/ContentNodeSurface";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ locale: "en", t: (key: string) => key }),
}));

describe("ContentNodeSurface", () => {
	it("renders an aspect-ratio placeholder before generation", () => {
		const markup = renderToStaticMarkup(
			<ContentNodeSurface
				kind="image-generator"
				status="idle"
				data={{ aspectRatio: "1:1" }}
				descriptionKey="node.description.image-generator"
			/>,
		);

		expect(markup).toContain("min-h-[112px]");
		expect(markup).toContain("node.description.image-generator");
	});

	it("renders generated media as the primary canvas content", () => {
		const markup = renderToStaticMarkup(
			<ContentNodeSurface
				kind="image-generator"
				status="succeeded"
				data={{ assetId: "asset" }}
				descriptionKey="node.description.image-generator"
				assetUrl="data:image/png;base64,AA=="
				assetKind="image"
			/>,
		);

		expect(markup).toContain("<img");
		expect(markup).toContain("data:image/png;base64,AA==");
		expect(markup).not.toContain("content-creation-node-surface__placeholder");
	});
});
