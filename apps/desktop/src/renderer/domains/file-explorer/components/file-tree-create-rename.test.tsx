// @vitest-environment jsdom
import { FileTreeCreateRow, FileTreeNodeView } from "@astravia-org/theme-ui/file-explorer";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const noop = (): void => {};

function createRow(overrides: Partial<Parameters<typeof FileTreeCreateRow>[0]> = {}) {
	const onSubmit = vi.fn();
	const onCancel = vi.fn();
	const result = render(
		<FileTreeCreateRow
			kind="file"
			depth={0}
			inputLabel="new file name"
			error={null}
			busy={false}
			onSubmit={onSubmit}
			onCancel={onCancel}
			{...overrides}
		/>,
	);
	return { onCancel, onSubmit, result };
}

describe("FileTreeCreateRow", () => {
	it("回车提交后由 busy 造成的失焦不会再取消掉这一行", () => {
		const { onCancel, onSubmit, result } = createRow();

		fireEvent.change(screen.getByRole("textbox"), { target: { value: "  notes.md  " } });
		fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

		expect(onSubmit).toHaveBeenCalledWith("notes.md");
		expect(onCancel).not.toHaveBeenCalled();

		// 父层把行切到 busy（input 变 disabled）时浏览器会补一次 blur。
		result.rerender(
			<FileTreeCreateRow
				kind="file"
				depth={0}
				inputLabel="new file name"
				error={null}
				busy={true}
				onSubmit={onSubmit}
				onCancel={onCancel}
			/>,
		);
		fireEvent.blur(screen.getByRole("textbox"));

		expect(onCancel).not.toHaveBeenCalled();
	});

	it("带着名字失焦即提交，空名字失焦就放弃", () => {
		const withName = createRow();
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "a.ts" } });
		fireEvent.blur(screen.getByRole("textbox"));
		expect(withName.onSubmit).toHaveBeenCalledWith("a.ts");
		expect(withName.onCancel).not.toHaveBeenCalled();
		withName.result.unmount();

		const empty = createRow();
		fireEvent.blur(screen.getByRole("textbox"));
		expect(empty.onSubmit).not.toHaveBeenCalled();
		expect(empty.onCancel).toHaveBeenCalled();
	});

	it("已经提示过错误后点到别处就当作放弃，不再重提同一个非法名字", () => {
		const { onCancel, onSubmit } = createRow({ error: "同名文件或文件夹已存在" });

		fireEvent.change(screen.getByRole("textbox"), { target: { value: "dup.ts" } });
		fireEvent.blur(screen.getByRole("textbox"));

		expect(onSubmit).not.toHaveBeenCalled();
		expect(onCancel).toHaveBeenCalled();
	});

	it("组合输入的回车只负责上屏候选词，不提前提交", () => {
		vi.useFakeTimers();
		try {
			const { onCancel, onSubmit } = createRow();
			const input = screen.getByRole("textbox");

			fireEvent.compositionStart(input);
			fireEvent.change(input, { target: { value: "zhong" } });
			fireEvent.keyDown(input, { key: "Enter" });
			expect(onSubmit).not.toHaveBeenCalled();

			// compositionend 与紧随其后的那次 keydown 顺序在各引擎不一致，仍不能当作提交。
			fireEvent.compositionEnd(input);
			fireEvent.change(input, { target: { value: "中文笔记.md" } });
			fireEvent.keyDown(input, { key: "Enter" });
			expect(onSubmit).not.toHaveBeenCalled();
			expect(onCancel).not.toHaveBeenCalled();

			vi.advanceTimersByTime(120);
			fireEvent.keyDown(input, { key: "Enter" });
			expect(onSubmit).toHaveBeenCalledWith("中文笔记.md");
		} finally {
			vi.useRealTimers();
		}
	});

	it("浏览器已标记 isComposing 的回车也不提交", () => {
		const { onSubmit } = createRow();
		const input = screen.getByRole("textbox");

		fireEvent.change(input, { target: { value: "拼音" } });
		fireEvent.keyDown(input, { key: "Enter", isComposing: true });

		expect(onSubmit).not.toHaveBeenCalled();
	});
});

const entry = { name: "main.ts", path: "/ws/src/main.ts", isDirectory: false, size: 12, modifiedAt: 0 };

function renameRow(props: { renameError?: string | null } = {}) {
	const onRenameSubmit = vi.fn();
	const onRenameCancel = vi.fn();
	render(
		<FileTreeNodeView
			entry={entry}
			depth={1}
			isExpanded={false}
			isLoading={false}
			isSelected
			isRenaming
			renameValue="app.ts"
			renameError={props.renameError ?? null}
			onRenameSubmit={onRenameSubmit}
			onRenameCancel={onRenameCancel}
			onToggleDir={noop}
			onSelectEntry={noop}
			onContextMenu={noop}
			onFileMove={noop}
			onExternalDrop={noop}
			onNativeDragStart={noop}
		/>,
	);
	return { onRenameCancel, onRenameSubmit };
}

describe("FileTreeNodeView 重命名光标", () => {
	const baseProps = {
		entry,
		depth: 1,
		isExpanded: false,
		isLoading: false,
		isSelected: true,
		isRenaming: true,
		renameError: null,
		onRenameSubmit: noop,
		onRenameCancel: noop,
		onToggleDir: noop,
		onSelectEntry: noop,
		onContextMenu: noop,
		onFileMove: noop,
		onExternalDrop: noop,
		onNativeDragStart: noop,
	};

	/**
	 * 虚拟列表会把滚出窗口的行卸载再挂回来。父层把草稿（值 + 光标）存在树里，
	 * 重新挂载的输入框在写入受控 value 时会被浏览器把光标丢到末尾——所以必须按草稿还原。
	 */
	it("行被回收后重新挂载，光标回到用户原来的位置而不是末尾", () => {
		let caret = 2;
		const first = render(
			<FileTreeNodeView
				{...baseProps}
				renameValue="ap.ts"
				renameCaret={caret}
				onRenameCaretChange={(next) => {
					caret = next;
				}}
			/>,
		);
		const input = screen.getByRole("textbox") as HTMLInputElement;
		input.focus();
		input.setSelectionRange(2, 2);
		fireEvent.select(input);
		expect(caret).toBe(2);
		first.unmount();

		render(<FileTreeNodeView {...baseProps} renameValue="ap.ts" renameCaret={caret} />);
		const remounted = screen.getByRole("textbox") as HTMLInputElement;
		expect(remounted.selectionStart).toBe(2);
		expect(remounted.selectionEnd).toBe(2);
	});

	it("刚进入重命名时选中主文件名，扩展名不被一起选中", () => {
		let caret = 0;
		render(
			<FileTreeNodeView
				{...baseProps}
				onRenameCaretChange={(next) => {
					caret = next;
				}}
			/>,
		);
		const input = screen.getByRole("textbox") as HTMLInputElement;
		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe("main".length);
		// 初始选区也要上报，否则第一次回收就把「选中主名」丢成末尾。
		expect(caret).toBe("main".length);
	});
});

describe("FileTreeNodeView rename", () => {
	it("失焦提交新名字", () => {
		const { onRenameCancel, onRenameSubmit } = renameRow();

		fireEvent.blur(screen.getByRole("textbox"));

		expect(onRenameSubmit).toHaveBeenCalledWith("/ws/src/main.ts", "app.ts");
		expect(onRenameCancel).not.toHaveBeenCalled();
	});

	it("校验失败时把错误显示在行内，失焦才算放弃", () => {
		const { onRenameCancel, onRenameSubmit } = renameRow({ renameError: "同名文件或文件夹已存在" });

		expect(within(screen.getByRole("treeitem").parentElement as HTMLElement).getByText("同名文件或文件夹已存在")).toBeTruthy();
		expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");

		fireEvent.blur(screen.getByRole("textbox"));

		expect(onRenameSubmit).not.toHaveBeenCalled();
		expect(onRenameCancel).toHaveBeenCalled();
	});

	it("中文重命名的回车只上屏候选词，不会被当成提交", () => {
		vi.useFakeTimers();
		try {
			const { onRenameCancel, onRenameSubmit } = renameRow();
			const input = screen.getByRole("textbox");

			fireEvent.compositionStart(input);
			fireEvent.keyDown(input, { key: "Enter" });
			fireEvent.compositionEnd(input);
			fireEvent.keyDown(input, { key: "Enter" });

			expect(onRenameSubmit).not.toHaveBeenCalled();
			expect(onRenameCancel).not.toHaveBeenCalled();

			vi.advanceTimersByTime(120);
			fireEvent.keyDown(input, { key: "Enter" });

			expect(onRenameSubmit).toHaveBeenCalledWith("/ws/src/main.ts", "app.ts");
		} finally {
			vi.useRealTimers();
		}
	});

	it("组合输入中的 Escape 留给输入法取消候选，不放弃重命名", () => {
		const { onRenameCancel } = renameRow();
		const input = screen.getByRole("textbox");

		fireEvent.compositionStart(input);
		fireEvent.keyDown(input, { key: "Escape" });

		expect(onRenameCancel).not.toHaveBeenCalled();
	});
});
