// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentModelDescriptor } from "../src/generation/types";
import { ContentVideoReferenceInput } from "../src/node/ContentVideoReferenceInput";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

const model: ContentModelDescriptor = {
	providerId: "host-media",
	modelId: "minimax-h3",
	displayName: "MiniMax H3",
	outputKind: "video",
	aspectRatios: ["16:9", "9:16"],
	modes: [
		{
			id: "image-to-video",
			inputs: [
				{ id: "firstFrame", accepts: ["image"], minItems: 0, maxItems: 1 },
				{ id: "lastFrame", accepts: ["image"], minItems: 0, maxItems: 1 },
			],
			minTotalItems: 1,
		},
		{
			id: "reference-to-video",
			inputs: [
				{ id: "referenceImages", accepts: ["image"], minItems: 0, maxItems: 9 },
				{ id: "referenceVideos", accepts: ["video"], minItems: 0, maxItems: 3 },
				{ id: "referenceAudios", accepts: ["audio"], minItems: 0, maxItems: 3 },
			],
			minTotalItems: 1,
		},
	],
};

describe("ContentVideoReferenceInput", () => {
	afterEach(cleanup);

	it("renders dedicated first/last-frame slots and imports into the selected role", async () => {
		const onImport = vi.fn().mockResolvedValue(undefined);
		const { container } = render(
			<ContentVideoReferenceInput
				modeId="image-to-video"
				model={model}
				references={[]}
				connectedReferences={[]}
				acceptedKinds={["image"]}
				disabled={false}
				onImport={onImport}
				onRemove={vi.fn()}
				onSelectConnected={vi.fn()}
			/>,
		);

		expect(screen.getByText("nodeEditor.videoReference.firstFrame")).toBeTruthy();
		expect(screen.getByText("nodeEditor.videoReference.lastFrame")).toBeTruthy();
		const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
		fireEvent.change(inputs[1] as HTMLInputElement, {
			target: { files: [new File(["last"], "last.png", { type: "image/png" })] },
		});

		await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
		expect(onImport.mock.calls[0]?.[1]).toBe("lastFrame");
		expect(onImport.mock.calls[0]?.[0]?.[0]).toMatchObject({ name: "last.png", mimeType: "image/png" });
	});

	it("switches to a mixed-media reference input for omni-reference mode", () => {
		const { container } = render(
			<ContentVideoReferenceInput
				modeId="reference-to-video"
				model={model}
				references={[]}
				connectedReferences={[]}
				acceptedKinds={["image", "video", "audio"]}
				disabled={false}
				onImport={vi.fn()}
				onRemove={vi.fn()}
				onSelectConnected={vi.fn()}
			/>,
		);

		expect(screen.queryByText("nodeEditor.videoReference.firstFrame")).toBeNull();
		expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toBe(
			"image/*,video/*,audio/*",
		);
	});
});
