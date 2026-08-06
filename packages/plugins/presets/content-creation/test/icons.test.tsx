import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NodeKindIcon } from "../src/node/NodeKindIcon";
import type { ContentNodeKind } from "../src/project/types";

describe("content creation icons", () => {
	it("maps node kinds to Iconify classes instead of hand-authored SVG", () => {
		const kinds: readonly ContentNodeKind[] = ["prompt", "image-generator", "video-generator", "asset", "output"];
		const markup = renderToStaticMarkup(
			<div>
				{kinds.map((kind) => (
					<NodeKindIcon key={kind} kind={kind} />
				))}
			</div>,
		);

		expect(markup).not.toContain("<svg");
		expect(markup.match(/icon-\[lucide--/g)).toHaveLength(5);
	});
});
