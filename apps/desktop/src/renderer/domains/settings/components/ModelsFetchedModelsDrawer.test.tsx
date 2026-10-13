// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelsProvidersSection } from "./ModelsProvidersSection";
import { useModelsSettingsModel } from "./useModelsSettingsModel";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./recordSettingsUsage", () => ({ recordSettingsUsage: vi.fn() }));
vi.mock("@shared/store/toast-atoms", () => ({ showToast: vi.fn() }));
vi.mock("@shared/store/model-catalog", async () => {
	const { atom } = await import("jotai");
	return {
		localModelsConfigAtom: atom({
			providers: {
				local: {
					api: "openai-completions",
					baseUrl: "http://localhost:11434/v1",
					models: [{ id: "qwen3" }],
				},
			},
		}),
		modelCatalog: { revalidate: vi.fn(async () => undefined) },
	};
});

const FETCHED = [
	{ id: "qwen3", contextWindow: 32768 },
	{ id: "llama3", reasoning: true },
	{ id: "gemma3", vision: true, ownedBy: "google" },
];

/** 只挂载设置页里模型配置的这一段，其余部分不影响抽屉行为。 */
function Harness(): JSX.Element {
	const model = useModelsSettingsModel();
	return <ModelsProvidersSection model={model} />;
}

/**
 * 抽屉内的交互一律用 `fireEvent`：`userEvent` 会派发 pointerdown/up，而 vaul 在 jsdom
 * 里处理指针释放时读不到计算样式（getComputedStyle 不实现 transform）会抛错。
 * 展开服务商、点「从接口拉取」仍在抽屉外，走 `userEvent` 的真实指针路径。
 */
function clickInDrawer(name: string | RegExp): void {
	fireEvent.click(screen.getByRole("button", { name }));
}

async function openFetchDrawer(user: ReturnType<typeof userEvent.setup>): Promise<void> {
	// 服务商行默认收起，先展开再点「从接口拉取」。
	await user.click(screen.getByRole("button", { name: /openai-completions/ }));
	await user.click(screen.getByRole("button", { name: "fetchModels" }));
	await screen.findByRole("button", { name: "addSelectedModels" });
	await screen.findByText("llama3");
}

function selectionToggle(modelId: string): HTMLElement {
	return screen.getByRole("button", { name: new RegExp(`^${modelId}`) });
}

function testButtonOf(modelId: string): HTMLElement {
	const row = selectionToggle(modelId).parentElement;
	return within(row as HTMLElement).getByRole("button", { name: "testConnect" });
}

function searchFetchedModels(query: string): void {
	fireEvent.change(screen.getByPlaceholderText("searchFetchedModels"), { target: { value: query } });
}

describe("ModelsFetchedModelsDrawer", () => {
	let set: ReturnType<typeof vi.fn>;
	let probe: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		// DetailDrawer 用 matchMedia 决定右侧还是底部滑出；jsdom 没有这个 API。
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn(),
		}));
		set = vi.fn(async () => undefined);
		probe = vi.fn(async () => ({ ok: true, message: "provider 可达（本地）" }));
		(window as unknown as { vetta: unknown }).vetta = {
			models: {
				set,
				probe,
				fetchProviderModels: vi.fn(async () => ({ models: FETCHED })),
			},
		};
	});

	it("lists the endpoint's models with their parameters and adds only the visible selection", async () => {
		const user = userEvent.setup();
		render(<Harness />);
		await openFetchDrawer(user);

		// 接口返回的模型参数直接展示在行内，已添加的模型带标记且不计入全选。
		expect(screen.getByText("32K ctx")).toBeTruthy();
		expect(screen.getByText("alreadyAdded")).toBeTruthy();

		searchFetchedModels("llama");
		await waitFor(() => expect(screen.queryByText("gemma3")).toBeNull());

		// 搜索后全选只覆盖当前可见的模型。
		clickInDrawer("selectAllFetchedModels");
		clickInDrawer("addSelectedModels");

		await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
		expect(set).toHaveBeenCalledWith({
			providers: {
				local: {
					api: "openai-completions",
					baseUrl: "http://localhost:11434/v1",
					// 接口给的「支持思考」随模型落盘，思考档位沿用 API 类型预设。
					models: [{ id: "qwen3" }, { id: "llama3", reasoning: true, input: ["text"] }],
				},
			},
		});
		// 添加完抽屉自动关闭（jsdom 不跑退场动画，内容仍在 DOM 里，看的是抽屉状态）。
		const drawer = document.querySelector('[data-slot="drawer-content"]');
		await waitFor(() => expect(drawer?.getAttribute("data-state")).toBe("closed"));
	});

	it("keeps selections that the search filter hides when deselecting all", async () => {
		const user = userEvent.setup();
		render(<Harness />);
		await openFetchDrawer(user);

		fireEvent.click(selectionToggle("gemma3"));
		expect(selectionToggle("gemma3").getAttribute("aria-pressed")).toBe("true");

		searchFetchedModels("llama");
		clickInDrawer("deselectAllFetchedModels");
		clickInDrawer("clearModelSearch");

		await screen.findByText("gemma3");
		expect(selectionToggle("gemma3").getAttribute("aria-pressed")).toBe("true");
		expect(selectionToggle("llama3").getAttribute("aria-pressed")).toBe("false");
	});

	it("tests one candidate's connectivity on its own row", async () => {
		const user = userEvent.setup();
		render(<Harness />);
		await openFetchDrawer(user);

		const testButton = testButtonOf("llama3");
		fireEvent.click(testButton);

		await waitFor(() => expect(probe).toHaveBeenCalledWith({ provider: "local", model: "llama3" }));
		await waitFor(() => expect(testButton.textContent).toContain("testOk"));
		// 其他模型不受影响。
		expect(testButtonOf("gemma3").textContent).toContain("testConnect");
	});
});
