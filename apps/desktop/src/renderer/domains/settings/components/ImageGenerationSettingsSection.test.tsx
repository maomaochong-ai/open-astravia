// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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
			setImageToImageRoute: vi.fn(async () => undefined),
			setTextToImageRoute: vi.fn(async () => undefined),
		},
		custom: {
			providers: [],
			draft: null,
			error: null,
			saving: false,
			startAdd: vi.fn(),
			startEdit: vi.fn(),
			cancel: vi.fn(),
			updateDraft: vi.fn(),
			save: vi.fn(async () => undefined),
			remove: vi.fn(async () => undefined),
			labels: {
				add: "Add service",
				apiKey: "API key",
				apiKeyKeepHint: "Saved",
				baseUrl: "Base URL",
				cancel: "Cancel",
				delete: "Delete",
				description: "Custom services",
				edit: "Edit",
				model: "Model",
				name: "Name",
				save: "Save",
				supportsImageToImage: "Image to image",
				supportsTextToImage: "Text to image",
				title: "Custom image services",
			},
		},
		imageToImageOptions: overrides.imageToImageOptions ?? [],
		imageToImageRouteId: "auto",
		labels: {
			description: "description",
			imageToImage: "Image to image",
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
	it("没有任何 provider 时下拉仍可展开，行内只说明缺失、不再挂安装引导", () => {
		const view = model({
			imageToImageOptions: [{ label: "Auto", value: "auto" }],
			textToImageOptions: [{ label: "Auto", value: "auto" }],
		});
		render(<ImageGenerationSettingsSection model={view} />);

		const textToImage = screen.getByLabelText("Text to image") as HTMLButtonElement;
		// 只有「自动选择」时下拉仍可展开：禁用会让入口看起来坏掉。
		expect(textToImage.disabled).toBe(false);
		expect(screen.getAllByText("no providers")).toHaveLength(2);
		// 「去能力页安装图像服务」这类引导链接属于能力页的事，设置项里不再出现。
		expect(screen.queryByText(/[Ii]nstall an image service/)).toBeNull();
		expect(screen.queryByText(/去能力页安装/)).toBeNull();
	});

	it("offers every installed provider and hides the missing hint", () => {
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
	});
});
