// @vitest-environment jsdom
/**
 * 宿主的模型选择器（`ModelSelect`）。
 *
 * 这条用例的存在理由：本组件曾经是 385 行自绘 `DropdownMenu`（分组子菜单 + 自带搜索），
 * 与会话输入栏的 `ModelSelectorView` 是两套交互。收敛后它渲染的就是输入栏那套三栏面板，
 * 所以这里断言「打开后出现服务商栏与推理档位列」——自绘下拉没有这两样，旧实现下必红。
 */
import { Provider, createStore } from "jotai";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { localModelsConfigAtom, remoteProvidersAtom } from "@shared/store/atoms";
import { ModelSelect } from "./ModelSelect";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
		i18n: { language: "zh", exists: () => true },
	}),
}));

// 只替换目录重校验：`atoms` 桶文件从同一模块再导出 atom，整块 mock 会让 atom 变成 undefined。
vi.mock("@shared/store/model-catalog", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@shared/store/model-catalog")>();
	return { ...actual, modelCatalog: { ...actual.modelCatalog, revalidate: vi.fn(async () => undefined) } };
});

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

const MODELS = {
	providers: {
		acme: {
			baseUrl: "https://acme.test/v1",
			api: "openai-completions",
			models: [
				{ id: "fast", name: "Fast", reasoning: true, reasoningLevels: ["low", "high"] },
				{ id: "slow", name: "Slow" },
			],
		},
	},
};

function renderSelect(props: Partial<React.ComponentProps<typeof ModelSelect>> = {}) {
	const store = createStore();
	store.set(localModelsConfigAtom, MODELS as never);
	store.set(remoteProvidersAtom, {} as never);
	const view = render(
		<Provider store={store}>
			<ModelSelect value={null} onChange={() => undefined} ariaLabel="pick-model" {...props} />
		</Provider>,
	);
	return { ...view, store };
}

async function openPanel(): Promise<HTMLElement> {
	await userEvent.click(screen.getByRole("button", { name: "pick-model" }));
	return waitFor(() => {
		const dialog = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
		if (!dialog) throw new Error("popover not opened");
		return dialog;
	});
}

describe("ModelSelect 与输入栏同源", () => {
	it("打开后是输入栏那套三栏面板：有服务商栏，也有推理档位列", async () => {
		vi.stubGlobal("ResizeObserver", ResizeObserverStub);
		renderSelect({ value: "acme/fast", reasoning: { value: undefined, onChange: () => undefined } });

		const panel = await openPanel();
		// 服务商栏是视图的三栏结构，自绘 DropdownMenu 没有这个分组。
		expect(within(panel).getByRole("group", { name: "modelSelect.providerHeader" })).toBeTruthy();
		// 推理档位是并排的第三栏（旧实现是悬停子菜单），档位标签直接出现在面板里。
		expect(within(panel).getByRole("group", { name: "modelSelect.reasoningHeader" })).toBeTruthy();
		expect(within(panel).getByRole("button", { name: "low" })).toBeTruthy();
		vi.unstubAllGlobals();
	});

	it("选中一个模型后把它的 key 交给调用方", async () => {
		vi.stubGlobal("ResizeObserver", ResizeObserverStub);
		const onChange = vi.fn();
		renderSelect({ onChange });

		const panel = await openPanel();
		await userEvent.click(within(panel).getAllByRole("button", { name: /Fast/ })[0]!);
		expect(onChange).toHaveBeenCalledWith("acme/fast");
		vi.unstubAllGlobals();
	});

	it("allowClear 时空值项回调 null，标签取 clearLabel", async () => {
		vi.stubGlobal("ResizeObserver", ResizeObserverStub);
		const onChange = vi.fn();
		renderSelect({ value: "acme/fast", allowClear: true, clearLabel: "不固定模型", onChange });

		const panel = await openPanel();
		await userEvent.click(within(panel).getByRole("button", { name: "不固定模型" }));
		expect(onChange).toHaveBeenCalledWith(null);
		vi.unstubAllGlobals();
	});
});
