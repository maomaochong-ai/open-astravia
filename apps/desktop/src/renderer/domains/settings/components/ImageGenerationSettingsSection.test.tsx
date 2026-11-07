// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageGenerationSettingsSection } from "./ImageGenerationSettingsSection";
import type { ImageGenerationSettingsModel } from "./useImageGenerationSettingsModel";

afterEach(cleanup);

function model(overrides: {
	imageToImageOptions?: ImageGenerationSettingsModel["imageToImageOptions"];
	textToImageOptions?: ImageGenerationSettingsModel["textToImageOptions"];
	textToImageRouteId?: string;
}): ImageGenerationSettingsModel {
	return {
		actions: {
			openMarketplace: vi.fn(),
			setImageToImageRoute: vi.fn(async () => undefined),
			setTextToImageRoute: vi.fn(async () => undefined),
		},
		imageToImageOptions: overrides.imageToImageOptions ?? [],
		imageToImageRouteId: "auto",
		labels: {
			description: "description",
			imageToImage: "Image to image",
			installProvider: "Install an image service in Abilities",
			loading: "loading",
			noProviders: "no providers",
			textToImage: "Text to image",
			title: "Image",
		},
		loading: false,
		textToImageOptions: overrides.textToImageOptions ?? [],
		textToImageRouteId: overrides.textToImageRouteId ?? "auto",
	};
}

describe("ImageGenerationSettingsSection", () => {
	it("keeps the dropdown usable when no image provider is installed and points at the abilities page", () => {
		const view = model({
			imageToImageOptions: [{ label: "Auto", value: "auto" }],
			textToImageOptions: [{ label: "Auto", value: "auto" }],
		});
		render(<ImageGenerationSettingsSection model={view} />);

		const textToImage = screen.getByLabelText("Text to image") as HTMLButtonElement;
		// 只有「自动选择」时下拉仍可展开：禁用会让入口看起来坏掉。
		expect(textToImage.disabled).toBe(false);
		expect(screen.getAllByText("no providers")).toHaveLength(2);

		const installButtons = screen.getAllByRole("button", { name: "Install an image service in Abilities" });
		expect(installButtons).toHaveLength(2);
		fireEvent.click(installButtons[0]!);
		expect(view.actions.openMarketplace).toHaveBeenCalledTimes(1);
	});

	it("offers every installed provider and hides the install hint", () => {
		const view = model({
			imageToImageOptions: [{ label: "Auto", value: "auto" }],
			textToImageOptions: [
				{ label: "Auto", value: "auto" },
				{ label: "Studio · Flux", value: "studio::flux" },
			],
			textToImageRouteId: "studio::flux",
		});
		render(<ImageGenerationSettingsSection model={view} />);

		const textToImage = screen.getByLabelText("Text to image") as HTMLButtonElement;
		expect(textToImage.disabled).toBe(false);
		// 选中的 provider 直接显示在触发器上，说明这一项真的可选、也真的被选中。
		expect(textToImage.textContent).toContain("Studio · Flux");
		// 文生图已有多项可选；只剩图生图没装 provider，所以提示只在那一行出现。
		expect(screen.getAllByText("no providers")).toHaveLength(1);
		expect(screen.getAllByRole("button", { name: "Install an image service in Abilities" })).toHaveLength(1);
	});
});
