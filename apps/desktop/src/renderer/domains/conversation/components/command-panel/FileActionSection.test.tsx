// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileActionSection } from "./FileActionSection";

afterEach(cleanup);

/**
 * ADR-0156：文件区段把原先散在工具行的「添加图片 / 附加文件引用」收进「添加」面板，
 * 三段动作都是直接点击目标。
 */
describe("文件区段", () => {
	it("渲染每段动作并带标题", () => {
		render(
			<FileActionSection
				title="文件"
				items={[
					{ id: "addFile", label: "添加文件", icon: "icon-[solar--paperclip-linear]", onSelect: vi.fn() },
					{ id: "addImage", label: "添加图片", icon: "icon-[solar--gallery-linear]", onSelect: vi.fn() },
				]}
			/>,
		);

		expect(screen.getByText("文件")).toBeTruthy();
		expect(screen.getByRole("button", { name: /添加文件/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /添加图片/ })).toBeTruthy();
	});

	it("点击某一段只触发那一段的动作", () => {
		const addFile = vi.fn();
		const addImage = vi.fn();
		render(
			<FileActionSection
				title="文件"
				items={[
					{ id: "addFile", label: "添加文件", icon: "icon-[solar--paperclip-linear]", onSelect: addFile },
					{ id: "addImage", label: "添加图片", icon: "icon-[solar--gallery-linear]", onSelect: addImage },
				]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /添加图片/ }));
		expect(addImage).toHaveBeenCalledOnce();
		expect(addFile).not.toHaveBeenCalled();
	});

	it("没有动作时不渲染空标题", () => {
		const { container } = render(<FileActionSection title="文件" items={[]} />);
		expect(container.textContent).toBe("");
	});
});
