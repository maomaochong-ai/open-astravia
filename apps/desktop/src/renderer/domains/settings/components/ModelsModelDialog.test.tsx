// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelsModelDialog } from "./ModelsModelDialog";
import { useModelsSettingsModel } from "./useModelsSettingsModel";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./recordSettingsUsage", () => ({ recordSettingsUsage: vi.fn() }));
vi.mock("@shared/store/toast-atoms", () => ({ showToast: vi.fn() }));
vi.mock("@shared/store/model-catalog", async () => {
	const { atom } = await import("jotai");
	return {
		localModelsConfigAtom: atom({
			providers: { local: { baseUrl: "http://localhost:11434/v1", models: [{ id: "qwen3" }] } },
		}),
		modelCatalog: { revalidate: vi.fn(async () => undefined) },
	};
});

const CATALOG_META = {
	provider: "openrouter",
	modelId: "deepseek-v4.1-flash",
	name: "DeepSeek V4.1 Flash",
	reasoning: true,
	reasoningLevels: ["low", "high"],
	contextWindow: 131072,
	maxTokens: 8192,
	vision: true,
};

function mockModelsApi(overrides: { probe?: unknown } = {}): { set: ReturnType<typeof vi.fn> } {
	const set = vi.fn(async () => undefined);
	(window as unknown as { vetta: unknown }).vetta = {
		models: {
			set,
			lookupModelMetadata: vi.fn(async () => CATALOG_META),
			probe: overrides.probe ?? vi.fn(async () => ({ ok: true, message: "provider 可达（本地）" })),
		},
	};
	return { set };
}

function Harness(): JSX.Element {
	const model = useModelsSettingsModel();
	return (
		<>
			<button type="button" onClick={() => model.onStartAddModel("local")}>
				open
			</button>
			<ModelsModelDialog model={model} />
		</>
	);
}

describe("ModelsModelDialog", () => {
	it("syncs empty fields from the models.dev catalog without overwriting manual input", async () => {
		const { set } = mockModelsApi();
		render(<Harness />);
		fireEvent.click(screen.getByText("open"));

		// 手填的显示名称不允许被同步覆盖。
		fireEvent.change(screen.getByPlaceholderText("modelIdPlaceholder"), { target: { value: "deepseek-v4.1-flash" } });
		fireEvent.change(screen.getByPlaceholderText("optional"), { target: { value: "我的闪存模型" } });

		fireEvent.click(screen.getByText("syncCatalogParams"));
		await waitFor(() => expect(screen.getByText("syncCatalogDone")).toBeTruthy());

		expect((screen.getByPlaceholderText("optional") as HTMLInputElement).value).toBe("我的闪存模型");
		expect((screen.getByPlaceholderText("contextWindowPlaceholder") as HTMLInputElement).value).toBe("131072");
		expect(
			(screen.getByPlaceholderText("maxOutputTokensPlaceholder") as HTMLInputElement).value,
		).toBe("8192");

		fireEvent.click(screen.getByText("add"));
		await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
		expect(set).toHaveBeenCalledWith({
			providers: {
				local: {
					baseUrl: "http://localhost:11434/v1",
					models: [
						{ id: "qwen3" },
						{
							id: "deepseek-v4.1-flash",
							name: "我的闪存模型",
							reasoning: true,
							reasoningLevels: ["low", "high"],
							input: ["text", "image"],
							contextWindow: 131072,
							maxTokens: 8192,
						},
					],
				},
			},
		});
	});

	it("shows the probe result inline after testing connectivity", async () => {
		const probe = vi.fn(async () => ({ ok: false, error: "provider 不可达：目标地址" }));
		mockModelsApi({ probe });
		render(<Harness />);
		fireEvent.click(screen.getByText("open"));

		fireEvent.change(screen.getByPlaceholderText("modelIdPlaceholder"), { target: { value: "deepseek-v4.1-flash" } });
		fireEvent.click(screen.getByText("testConnect"));

		await waitFor(() => expect(probe).toHaveBeenCalledWith({ provider: "local", model: "deepseek-v4.1-flash" }));
		await waitFor(() => expect(screen.getByText("provider 不可达：目标地址")).toBeTruthy());
	});
});
