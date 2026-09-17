// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AUTO_IMAGE_PROVIDER_ID, useImageGenerationSettingsModel } from "./useImageGenerationSettingsModel";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./recordSettingsUsage", () => ({ recordSettingsUsage: vi.fn() }));

describe("useImageGenerationSettingsModel", () => {
	it("lists providers by supported mode and persists user selections", async () => {
		const set = vi.fn(async () => undefined);
		const onMediaProvidersChanged = vi.fn(() => () => undefined);
		(window as unknown as { vetta: unknown }).vetta = {
			config: {
				get: vi.fn(async () => ({
					imageGeneration: { textToImageProviderId: "remote:all" },
				})),
				set,
			},
			media: {
				listProviders: vi.fn(async () => [
					{
						id: "remote:all",
						displayName: "Remote Images",
						ownerId: "remote",
						protocolVersion: 5,
						capabilities: [
							{
								operation: "generate",
								kind: "image",
								modes: ["text-to-image", "image-to-image"],
								models: [
									{ id: "openai/gpt-image-2", displayName: "GPT Image 2", sourceDisplayName: "OpenAI", modes: ["text-to-image", "image-to-image"] },
								],
								defaultModelId: "openai/gpt-image-2",
							},
						],
					},
					{
						id: "remote:text-only",
						ownerId: "remote",
						protocolVersion: 5,
						capabilities: [
							{ operation: "generate", kind: "image", modes: ["text-to-image"] },
						],
					},
				]),
			},
			plugins: { onMediaProvidersChanged },
		};

		const { result } = renderHook(() => useImageGenerationSettingsModel());
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(result.current.textToImageRouteId).toBe("remote%3Aall::openai%2Fgpt-image-2");
		expect(result.current.textToImageOptions.map((option) => option.value)).toEqual([
			AUTO_IMAGE_PROVIDER_ID,
			"remote%3Aall::openai%2Fgpt-image-2",
			"remote%3Atext-only",
		]);
		expect(result.current.imageToImageOptions.map((option) => option.value)).toEqual([
			AUTO_IMAGE_PROVIDER_ID,
			"remote%3Aall::openai%2Fgpt-image-2",
		]);

		await act(async () => {
			await result.current.actions.setImageToImageRoute("remote%3Aall::openai%2Fgpt-image-2");
		});
		expect(set).toHaveBeenCalledWith({
			imageGeneration: { imageToImageProviderId: "remote:all", imageToImageModelId: "openai/gpt-image-2" },
		});

		await act(async () => {
			await result.current.actions.setTextToImageRoute(AUTO_IMAGE_PROVIDER_ID);
		});
		expect(set).toHaveBeenLastCalledWith({
			imageGeneration: { textToImageProviderId: null, textToImageModelId: null },
		});
		expect(onMediaProvidersChanged).toHaveBeenCalledOnce();
	});

	it("keeps a missing saved provider visible as unavailable", async () => {
		(window as unknown as { vetta: unknown }).vetta = {
			config: {
				get: vi.fn(async () => ({ imageGeneration: { textToImageProviderId: "missing:images" } })),
				set: vi.fn(async () => undefined),
			},
			media: { listProviders: vi.fn(async () => []) },
			plugins: { onMediaProvidersChanged: vi.fn(() => () => undefined) },
		};
		const { result } = renderHook(() => useImageGenerationSettingsModel());
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(result.current.textToImageOptions).toContainEqual({
			value: "missing%3Aimages",
			label: "missing:images (agentSettings.imageGeneration.unavailable)",
		});
	});
});
