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
						protocolVersion: 4,
						capabilities: [
							{
								operation: "generate",
								kind: "image",
								modes: ["text-to-image", "image-to-image"],
							},
						],
					},
					{
						id: "remote:text-only",
						ownerId: "remote",
						protocolVersion: 4,
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

		expect(result.current.textToImageProviderId).toBe("remote:all");
		expect(result.current.textToImageOptions.map((option) => option.value)).toEqual([
			AUTO_IMAGE_PROVIDER_ID,
			"remote:all",
			"remote:text-only",
		]);
		expect(result.current.imageToImageOptions.map((option) => option.value)).toEqual([
			AUTO_IMAGE_PROVIDER_ID,
			"remote:all",
		]);

		await act(async () => {
			await result.current.actions.setImageToImageProvider("remote:all");
		});
		expect(set).toHaveBeenCalledWith({
			imageGeneration: { imageToImageProviderId: "remote:all" },
		});

		await act(async () => {
			await result.current.actions.setTextToImageProvider(AUTO_IMAGE_PROVIDER_ID);
		});
		expect(set).toHaveBeenLastCalledWith({
			imageGeneration: { textToImageProviderId: null },
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
			value: "missing:images",
			label: "missing:images (agentSettings.imageGeneration.unavailable)",
		});
	});
});
