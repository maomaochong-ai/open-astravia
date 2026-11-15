// @vitest-environment jsdom
/**
 * 插件合同 → 宿主 `ModelSelect` 的映射。
 *
 * 关键在空值语义：插件用 `emptyOption` 表达「跟随默认」，宿主用 `allowClear` + `clearLabel`。
 * 映射丢掉这一项，插件里就再也回不到「跟随默认」；映射错方向（把 `className` 当菜单类名）
 * 则菜单会被更高层的浮层盖住。
 */
import { Provider, createStore } from "jotai";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { localModelsConfigAtom, remoteProvidersAtom } from "@shared/store/atoms";
import { PluginModelPicker } from "./PluginModelPicker";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
		i18n: { language: "zh", exists: () => true },
	}),
}));

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
		acme: { baseUrl: "https://acme.test/v1", api: "openai-completions", models: [{ id: "fast", name: "Fast" }] },
	},
};

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

function renderPicker(props: Partial<React.ComponentProps<typeof PluginModelPicker>> = {}) {
	const store = createStore();
	store.set(localModelsConfigAtom, MODELS as never);
	store.set(remoteProvidersAtom, {} as never);
	render(
		<Provider store={store}>
			<PluginModelPicker value={null} onChange={() => undefined} ariaLabel="插件模型" {...props} />
		</Provider>,
	);
}

describe("PluginModelPicker", () => {
	it("emptyOption 映射成宿主的空值项文案，className 落在触发器、menuClassName 落在菜单", async () => {
		renderPicker({
			emptyOption: { label: "跟随默认" },
			placeholder: "跟随默认",
			className: "w-full",
			menuClassName: "z-[110]",
			defaultModelKey: "acme/fast",
		});

		const trigger = screen.getByRole("button", { name: "插件模型" });
		// 未选中且有空值项时，触发器显示占位文案（也就是「跟随默认」）。
		expect(trigger.textContent).toContain("跟随默认");
		expect(trigger.className).toContain("w-full");
		// field 形态的皮肤来自宿主设置页下拉，插件不该看到输入栏胶囊的圆角。
		expect(trigger.className).toContain("rounded-lg");
		expect(trigger.className).not.toContain("rounded-full");

		await userEvent.click(trigger);
		const panel = await waitFor(() => {
			const found = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
			if (!found) throw new Error("popover not opened");
			return found;
		});
		// menuClassName 必须落在弹出面板上，插件才能把它抬到更高浮层之上。
		expect(panel?.className).toContain("z-[110]");
	});

	it("没有 emptyOption 时不提供「跟随默认」这一项", async () => {
		renderPicker({ value: "acme/fast" });

		await userEvent.click(screen.getByRole("button", { name: "插件模型" }));
		const panel = await waitFor(() => {
			const found = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
			if (!found) throw new Error("popover not opened");
			return found;
		});
		// 空值项缺席：面板里没有「未设置」按钮，只有模型行。
		expect(panel?.textContent).not.toContain("modelSelect.unset");
	});
});
