// @vitest-environment jsdom

import type { MarketplaceSource } from "@preload/api";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => options?.error ?? key }),
}));

import { MarketplaceSourcesDialog } from "./MarketplaceSourcesDialog";

function source(overrides: Partial<MarketplaceSource>): MarketplaceSource {
	return {
		id: "custom-1",
		name: "my-abilities",
		type: "github",
		repository: "https://github.com/me/my-abilities",
		archiveUrl: "https://github.com/me/my-abilities/archive/refs/heads/main.zip",
		ref: "main",
		enabled: true,
		builtin: false,
		autoUpdate: true,
		priority: 200,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("MarketplaceSourcesDialog", () => {
	const onAdd = vi.fn(async () => undefined);
	const onUpdate = vi.fn(async () => undefined);
	const onRemove = vi.fn(async () => undefined);
	const onClose = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	function renderDialog(sources: MarketplaceSource[]): void {
		render(
			<MarketplaceSourcesDialog
				sources={sources}
				onAdd={onAdd}
				onUpdate={onUpdate}
				onRemove={onRemove}
				onClose={onClose}
			/>,
		);
	}

	it("内置来源只显示启停开关，不显示编辑与删除", () => {
		renderDialog([source({ id: "vetta-official", name: "official", builtin: true })]);

		expect(screen.getByText("abilities:sources.builtinBadge")).toBeTruthy();
		expect(screen.getByRole("switch")).toBeTruthy();
		expect(screen.queryByTitle("abilities:sources.actions.edit")).toBeNull();
		expect(screen.queryByTitle("abilities:sources.actions.remove")).toBeNull();
	});

	it("切换启停开关会调用 onUpdate(id, { enabled })", async () => {
		const user = userEvent.setup();
		renderDialog([source({ enabled: true })]);

		await user.click(screen.getByRole("switch"));

		await waitFor(() => expect(onUpdate).toHaveBeenCalledWith("custom-1", { enabled: false }));
	});

	it("删除来源需要行内二次确认", async () => {
		const user = userEvent.setup();
		renderDialog([source({})]);

		await user.click(screen.getByTitle("abilities:sources.actions.remove"));
		expect(onRemove).not.toHaveBeenCalled();

		await user.click(screen.getByText("abilities:sources.actions.confirmRemove"));
		await waitFor(() => expect(onRemove).toHaveBeenCalledWith("custom-1"));
	});

	it("添加来源：填写仓库后提交调用 onAdd", async () => {
		const user = userEvent.setup();
		renderDialog([]);

		await user.click(screen.getByText("abilities:sources.actions.add"));
		await user.type(
			screen.getByPlaceholderText("abilities:sources.form.repositoryPlaceholder"),
			"openvetta/vetta-official-marketplace",
		);
		await user.click(screen.getByText("abilities:sources.form.submitAdd"));

		await waitFor(() =>
			expect(onAdd).toHaveBeenCalledWith({ repository: "openvetta/vetta-official-marketplace", ref: "main" }),
		);
	});

	it("编辑来源：仓库地址锁定，改分支后提交调用 onUpdate", async () => {
		const user = userEvent.setup();
		renderDialog([source({})]);

		await user.click(screen.getByTitle("abilities:sources.actions.edit"));
		const repositoryInput = screen.getByPlaceholderText<HTMLInputElement>(
			"abilities:sources.form.repositoryPlaceholder",
		);
		expect(repositoryInput.disabled).toBe(true);

		const refInput = screen.getByPlaceholderText("abilities:sources.form.refPlaceholder");
		await user.clear(refInput);
		await user.type(refInput, "release");
		await user.click(screen.getByText("abilities:sources.form.submitEdit"));

		await waitFor(() => expect(onUpdate).toHaveBeenCalledWith("custom-1", { name: "my-abilities", ref: "release" }));
	});

	it("操作失败时展示错误并保持对话框打开", async () => {
		const user = userEvent.setup();
		onRemove.mockRejectedValueOnce(new Error("network down"));
		renderDialog([source({})]);

		await user.click(screen.getByTitle("abilities:sources.actions.remove"));
		await user.click(screen.getByText("abilities:sources.actions.confirmRemove"));

		expect(await screen.findByText("network down")).toBeTruthy();
		expect(onClose).not.toHaveBeenCalled();
	});
});
