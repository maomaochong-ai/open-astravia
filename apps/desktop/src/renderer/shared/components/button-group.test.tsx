// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ButtonGroup, ButtonGroupItem } from "@astravia-org/ui/button-group";
import { SessionTopItem } from "@astravia-org/ui/session-top-item";

afterEach(cleanup);

/**
 * 按钮组是顶栏的公共原语：宿主内置动作与插件顶栏动作都会渲染成它。
 * 这里钉住三件在顶栏上真正影响可用性的事——成组语义、角标阈值、选中态。
 */
describe("ButtonGroup", () => {
	it("整组带 group 语义，组内按钮都是 button 类型（不会误触发表单提交）", () => {
		render(
			<ButtonGroup aria-label="会话操作">
				<ButtonGroupItem icon={<span />} title="面板" />
				<ButtonGroupItem icon={<span />} label="导出" />
			</ButtonGroup>,
		);

		expect(screen.getByRole("group", { name: "会话操作" })).toBeTruthy();
		for (const button of screen.getAllByRole("button")) {
			expect(button.getAttribute("type")).toBe("button");
		}
	});

	it("角标：0 不显示、>99 折成 99+、true 为红点", () => {
		const { rerender } = render(
			<ButtonGroup>
				<ButtonGroupItem icon={<span />} aria-label="零" badge={0} />
				<ButtonGroupItem icon={<span />} aria-label="多" badge={128} />
				<ButtonGroupItem icon={<span />} aria-label="点" badge />
			</ButtonGroup>,
		);

		expect(screen.getByRole("button", { name: "零" }).textContent).toBe("");
		expect(screen.getByRole("button", { name: "多" }).textContent).toBe("99+");
		// 红点没有文字，只占一个节点。
		expect(screen.getByRole("button", { name: "点" }).textContent).toBe("");

		rerender(
			<ButtonGroup>
				<ButtonGroupItem icon={<span />} aria-label="少" badge={3} />
			</ButtonGroup>,
		);
		expect(screen.getByRole("button", { name: "少" }).textContent).toBe("3");
	});

	it("选中态同时反映为 data-active 与 aria-pressed", () => {
		render(
			<ButtonGroup>
				<ButtonGroupItem icon={<span />} title="面板" active />
			</ButtonGroup>,
		);

		const button = screen.getByRole("button", { name: "面板" });
		expect(button.getAttribute("data-active")).toBe("true");
		expect(button.getAttribute("aria-pressed")).toBe("true");
	});

	it("点组内按钮只触发自己那一个回调", () => {
		const panels = vi.fn();
		const exportFn = vi.fn();
		render(
			<ButtonGroup>
				<ButtonGroupItem icon={<span />} title="面板" onClick={panels} />
				<ButtonGroupItem icon={<span />} title="导出" onClick={exportFn} />
			</ButtonGroup>,
		);

		fireEvent.click(screen.getByRole("button", { name: "导出" }));
		expect(exportFn).toHaveBeenCalledOnce();
		expect(panels).not.toHaveBeenCalled();
	});
});

describe("SessionTopItem", () => {
	it("单独使用时自己包一层胶囊；组内使用不再嵌套", () => {
		const { container, rerender } = render(<SessionTopItem icon={<span />} title="单独" />);
		expect(container.querySelectorAll('[data-slot="button-group"]')).toHaveLength(1);

		rerender(
			<ButtonGroup>
				<SessionTopItem icon={<span />} title="组内" />
			</ButtonGroup>,
		);
		expect(container.querySelectorAll('[data-slot="button-group"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="button-group-item"]')).toHaveLength(1);
	});

	it("带 menuItems 时点开就是菜单模式，普通 onClick 不触发", () => {
		const onClick = vi.fn();
		const onSelect = vi.fn();
		render(<SessionTopItem icon={<span />} title="打开方式" onClick={onClick} menuItems={[{ id: "a", label: "用 VS Code 打开", onSelect }]} />);

		fireEvent.click(screen.getByRole("button", { name: "打开方式" }));
		expect(onClick).not.toHaveBeenCalled();
	});
});
