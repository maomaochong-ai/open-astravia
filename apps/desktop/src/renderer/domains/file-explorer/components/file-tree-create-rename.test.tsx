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
});
