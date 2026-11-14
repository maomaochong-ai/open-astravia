// @vitest-environment jsdom
/**
 * 默认模型选择器：与输入栏同源，并把「按模型记忆」的思考档位一起带上——
 * 在设置里选过档位，新会话发消息时就按这个档位走。
 */
import { Provider, createStore } from "jotai";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reasoningByModelAtom } from "@shared/store/atoms";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

// 宿主渲染的 ModelSelect 在测试里换成两个按钮：一个改模型，一个改思考档位。
vi.mock("@shared/components/ModelSelect", () => ({
	ModelSelect: ({
		value,
		onChange,
		reasoning,
		clearLabel,
	}: {
		value: string | null;
		onChange: (key: string | null) => void;
		reasoning?: { value?: string; onChange: (level: string) => void };
		clearLabel?: string;
	}) => (
		<div>
			<span data-testid="value">{value ?? "null"}</span>
			<span data-testid="reasoning">{reasoning?.value ?? "unset"}</span>
			<button type="button" onClick={() => onChange("openai/gpt-5")}>
				pick
			</button>
			<button type="button" onClick={() => onChange(null)}>
				{clearLabel}
			</button>
			<button type="button" onClick={() => reasoning?.onChange("high")}>
				set-high
			</button>
		</div>
	),
}));

const { ModelsDefaultModelSection } = await import("./ModelsDefaultModelSection.js");

function model(overrides: { defaultModel?: string; onChangeDefaultModel?: (key: string | null) => Promise<void> } = {}) {
	return {
		config: { defaultModel: overrides.defaultModel } as unknown as ModelsSettingsModel["config"],
		onChangeDefaultModel: overrides.onChangeDefaultModel ?? vi.fn(async () => {}),
	} as unknown as ModelsSettingsModel;
}

describe("默认模型选择器", () => {
	it("选中模型后写回默认模型", async () => {
		const onChangeDefaultModel = vi.fn(async () => {});
		render(<ModelsDefaultModelSection model={model({ onChangeDefaultModel })} />);

		await userEvent.click(screen.getByRole("button", { name: "pick" }));
		expect(onChangeDefaultModel).toHaveBeenCalledWith("openai/gpt-5");
	}, 20_000);

	it("当前没有默认模型时显示未设置，清空会写回 null", async () => {
		const onChangeDefaultModel = vi.fn(async () => {});
		render(<ModelsDefaultModelSection model={model({ onChangeDefaultModel })} />);

		expect(screen.getByTestId("value").textContent).toBe("null");
		await userEvent.click(screen.getByRole("button", { name: "defaultModelSection.unset" }));
		expect(onChangeDefaultModel).toHaveBeenCalledWith(null);
	}, 20_000);

	it("思考档位取自「按模型记忆」的那份，改它写回同一份记忆", async () => {
		const store = createStore();
		store.set(reasoningByModelAtom, { "openai/gpt-5": "low" });
		render(
			<Provider store={store}>
				<ModelsDefaultModelSection model={model({ defaultModel: "openai/gpt-5" })} />
			</Provider>,
		);

		expect(screen.getByTestId("reasoning").textContent).toBe("low");
		await userEvent.click(screen.getByRole("button", { name: "set-high" }));
		expect(store.get(reasoningByModelAtom)).toEqual({ "openai/gpt-5": "high" });
	}, 20_000);
});
