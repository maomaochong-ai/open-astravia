// @vitest-environment jsdom
/**
 * 预置服务商行：开关常驻、编辑一律走弹窗。
 *
 * 这两条都是与参照实现对齐后的形态：开关不再只在「已采纳」时渲染（未采纳时它是「关」，
 * 拨开即启用），API Key 与端口也不再是行内输入框——窄屏下行内输入会把左侧服务商名挤没。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresetProviderRowView, type PresetProviderRowViewLabels } from "@astravia-org/theme-ui/settings";
import type { PresetProviderRowModelView } from "@astravia-org/theme-ui/settings";

afterEach(cleanup);

const labels: PresetProviderRowViewLabels = {
	apiKeyDirect: (name) => `设置 ${name} 的 API Key`,
	apiKeyLabel: "API Key",
	apiKeyPlaceholder: "sk-…",
	cancel: "取消",
	changeKey: "更换密钥",
	collapseModels: "收起模型",
	copyApiKey: "复制密钥",
	deprecated: "已下线",
	enable: "启用",
	enabled: "已启用",
	encryptedApiKeyPlaceholder: "已保存，留空沿用",
	modelsCount: (count) => `${count} 个模型`,
	port: "端口",
	portLabel: "修改端口",
	refreshModels: "刷新模型",
	refreshingModels: "正在刷新",
	remove: "移除",
	save: "保存",
	toggleProvider: (name) => `启用 ${name}`,
	viewModels: "查看模型",
};

function row(overrides: Partial<PresetProviderRowModelView> = {}): PresetProviderRowModelView {
	return {
		adopted: true,
		autoKey: false,
		baseUrl: "http://127.0.0.1:3425/v1",
		displayName: "本机代理",
		enabled: true,
		hasApiKey: true,
		icon: "magpie",
		isExpanded: false,
		isOpen: false,
		models: [1, 2, 3],
		modelsError: null,
		offline: false,
		refreshing: false,
		...overrides,
	};
}

function renderRow(overrides: Partial<React.ComponentProps<typeof PresetProviderRowView>> = {}) {
	const props: React.ComponentProps<typeof PresetProviderRowView> = {
		draftKey: "",
		icon: <span data-testid="icon" />,
		labels,
		onAdopt: vi.fn(),
		onCopyApiKey: vi.fn(),
		onDraftKeyChange: vi.fn(),
		onRefreshModels: vi.fn(),
		onRemove: vi.fn(),
		onSetPort: vi.fn(),
		onToggleEditor: vi.fn(),
		onToggleEnabled: vi.fn(),
		onToggleExpanded: vi.fn(),
		row: row(),
		saving: false,
		...overrides,
	};
	return { ...render(<PresetProviderRowView {...props} />), props };
}

describe("PresetProviderRowView", () => {
	it("行尾开关常驻，未采纳时也是「关」并可拨开启用", () => {
		const { props } = renderRow({ row: row({ adopted: false, enabled: false }) });
		const toggle = screen.getByRole("switch", { name: "启用 本机代理" });
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		fireEvent.click(toggle);
		expect(props.onToggleEnabled).toHaveBeenCalledWith(true);
	});

	it("编辑 API Key 走弹窗：草稿为空时保存禁用，有草稿才回传", () => {
		const onAdopt = vi.fn();
		const empty = renderRow({ row: row({ isOpen: true }), onAdopt });
		expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
		empty.unmount();

		const { props } = renderRow({ draftKey: "sk-live", row: row({ isOpen: true }), onAdopt });
		const input = screen.getByLabelText("设置 本机代理 的 API Key");
		fireEvent.change(input, { target: { value: "sk-live-2" } });
		expect(props.onDraftKeyChange).toHaveBeenCalledWith("sk-live-2");
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		expect(onAdopt).toHaveBeenCalled();
	});

	/**
	 * 内置密钥的预设（本机代理这类）根本没有「填 key」这件事：它有默认地址与默认密钥，
	 * 用户只需要开关。给它一颗钥匙按钮，等于让人以为必须先有一个 key 才能用。
	 */
	it("内置密钥的预设不给密钥按钮，也不给删除入口", () => {
		renderRow({
			row: row({ adopted: false, autoKey: true, baseUrl: "http://127.0.0.1:3425/v1", enabled: false }),
		});
		expect(screen.queryByRole("button", { name: "启用" })).toBeNull();
		expect(screen.queryByRole("button", { name: "更换密钥" })).toBeNull();
		expect(screen.queryByRole("button", { name: "移除" })).toBeNull();
		// 开关与端口编辑仍然要在：用户要能停用它、也要能改端口。
		expect(screen.getByRole("switch", { name: "启用 本机代理" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "修改端口" })).toBeTruthy();
	});

	it("本机代理只开放端口：弹窗里带上固定主机前缀，非法端口不能保存", () => {
		const onSetPort = vi.fn();
		renderRow({ row: row({ autoKey: true }), onSetPort });
		fireEvent.click(screen.getByRole("button", { name: "修改端口" }));
		expect(screen.getByText("http://127.0.0.1:")).toBeTruthy();
		const input = screen.getByRole("textbox", { name: "修改端口" });
		fireEvent.change(input, { target: { value: "99999" } });
		expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
		fireEvent.change(input, { target: { value: "4000" } });
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		expect(onSetPort).toHaveBeenCalledWith("4000");
	});

	it("已下线的服务商不给开关也不给编辑，只留一个「已下线」说明", () => {
		renderRow({ row: row({ adopted: false, enabled: false, offline: true }) });
		expect(screen.queryByRole("switch")).toBeNull();
		expect(screen.queryByRole("button", { name: "启用" })).toBeNull();
	});
});
