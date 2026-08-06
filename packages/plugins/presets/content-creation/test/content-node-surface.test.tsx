import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ContentNodeSurface } from "../src/node/ContentNodeSurface";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ locale: "en", t: (key: string) => key }),
}));

vi.mock("@vetta/ui", () => ({
	Spin: ({ label }: { label?: string }) => <span data-testid="spin">{label}</span>,
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

		expect(markup).toContain("h-full w-full");
		expect(markup).toContain("node.description.image-generator");
		expect(markup).toContain("border-dashed");
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
		expect(markup).not.toContain("border-dashed");
	});

	it("shows a themed busy overlay while generating", () => {
		const markup = renderToStaticMarkup(
			<ContentNodeSurface
				kind="image-generator"
				status="running"
				data={{ aspectRatio: "1:1" }}
				descriptionKey="node.description.image-generator"
				job={{
					id: "j1",
					nodeId: "n1",
					provider: "openai",
					model: "m",
					status: "running",
					progress: 0.4,
					createdAt: "",
					updatedAt: "",
				}}
			/>,
		);

		expect(markup).toContain("action.generating");
		expect(markup).toContain("job.progress");
	});

	it("keeps large asset collections compact on the canvas", () => {
		const assets = Array.from({ length: 8 }, (_, index) => ({
			id: `asset-${index}`,
			blobId: `asset-${index}`,
			kind: "image" as const,
			name: `Asset ${index}`,
			mimeType: "image/png",
			previewUrl: `data:image/png;base64,${index}`,
			createdAt: "2026-01-01T00:00:00.000Z",
		}));
		const markup = renderToStaticMarkup(
			<ContentNodeSurface
				kind="asset"
				status="idle"
				data={{ assetIds: assets.map((asset) => asset.id) }}
				descriptionKey="node.description.asset"
				assets={assets}
			/>,
		);

		expect(markup.match(/<img/g)).toHaveLength(3);
		expect(markup).toContain("assetNode.more");
	});
});
