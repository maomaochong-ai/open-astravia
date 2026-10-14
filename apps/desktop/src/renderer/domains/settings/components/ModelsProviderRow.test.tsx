// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MODEL_PAGE_SIZE, ModelsProviderRow } from "./ModelsProviderRow";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, opts?: { n?: number }) => (opts?.n === undefined ? key : `${key}:${opts.n}`),
	}),
}));

vi.mock("./ModelsProviderForm", () => ({ ModelsProviderForm: () => null }));

const MANY_MODELS = Array.from({ length: 25 }, (_, index) => ({ id: `model-${index + 1}` }));

function stubModel(overrides: { expandedProvider?: string | null } = {}): ModelsSettingsModel {
	return {
		config: {
			providers: {
				local: { baseUrl: "http://localhost:11434/v1", models: MANY_MODELS },
			},
		},
		expandedProvider: overrides.expandedProvider !== undefined ? overrides.expandedProvider : "local",
		editingProvider: null,
		fetchingModelsFor: null,
		saving: false,
		onToggleProvider: vi.fn(),
		onStartAddModel: vi.fn(),
		onStartEditProvider: vi.fn(),
		onCancelEditProvider: vi.fn(),
		onDeleteProvider: vi.fn(),
		onCopyProviderApiKey: vi.fn(),
		onStartEditModel: vi.fn(),
		onDeleteModel: vi.fn(),
		onSetDefaultModel: vi.fn(),
		onStartFetchProviderModels: vi.fn(),
	} as unknown as ModelsSettingsModel;
}

function visibleRowCount(): number {
	// 模型行的稳定特征是 group 类（行级 hover 容器）；id 文案在行内出现两次，不能按文本计数。
	return document.querySelectorAll(".group").length;
}

describe("ModelsProviderRow model list pagination", () => {
	it("shows the first page only and reveals the rest ten at a time", () => {
		render(<ModelsProviderRow name="local" model={stubModel()} />);

		expect(visibleRowCount()).toBe(MODEL_PAGE_SIZE);
		// 引导按钮带剩余数量，首屏后还剩 15 个。
		expect(screen.getByText("showMoreModels:15")).toBeTruthy();

		fireEvent.click(screen.getByText("showMoreModels:15"));

		expect(visibleRowCount()).toBe(MODEL_PAGE_SIZE * 2);
		expect(screen.getByText("showMoreModels:5")).toBeTruthy();

		fireEvent.click(screen.getByText("showMoreModels:5"));

		expect(visibleRowCount()).toBe(25);
		expect(screen.queryByText(/showMoreModels/)).toBeNull();
	});

	it("resets pagination when the provider is collapsed and expanded again", () => {
		const { rerender } = render(<ModelsProviderRow name="local" model={stubModel()} />);
		fireEvent.click(screen.getByText("showMoreModels:15"));
		expect(visibleRowCount()).toBe(20);

		// 收起后可见数应回到首页大小。
		rerender(<ModelsProviderRow name="local" model={stubModel({ expandedProvider: null })} />);
		rerender(<ModelsProviderRow name="local" model={stubModel()} />);

		expect(visibleRowCount()).toBe(MODEL_PAGE_SIZE);
	});
});
