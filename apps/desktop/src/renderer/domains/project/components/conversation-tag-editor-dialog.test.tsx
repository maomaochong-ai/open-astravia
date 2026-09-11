// @vitest-environment jsdom
import { ConversationTagEditorDialogView } from "@vetta/theme-ui/project";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CONVERSATION_TAG_PRESET_COLORS } from "../../../../shared/conversation-tags";

const LABELS = {
	createTitle: "New tag",
	manageTitle: "Manage tags",
	namePlaceholder: "Tag name",
	colorLabel: "Tag color",
	customColor: "Custom color",
	emptyNameError: "Enter a tag name",
	cancel: "Cancel",
	create: "Create",
	done: "Done",
	newTag: "New tag",
	remove: "Delete tag",
	empty: "No tags yet",
};

function renderDialog(overrides: Partial<Parameters<typeof ConversationTagEditorDialogView>[0]> = {}) {
	const props = {
		mode: "create" as const,
		tags: [],
		presetColors: CONVERSATION_TAG_PRESET_COLORS,
		labels: LABELS,
		onCreate: vi.fn(),
		onRename: vi.fn(),
		onRecolor: vi.fn(),
		onRemove: vi.fn(),
		onClose: vi.fn(),
		...overrides,
	};
	render(<ConversationTagEditorDialogView {...props} />);
	return props;
}

describe("ConversationTagEditorDialogView", () => {
	it("creates a tag with the picked preset colour and then closes", () => {
		const props = renderDialog();
		fireEvent.change(screen.getByPlaceholderText("Tag name"), { target: { value: "  紧急  " } });
		fireEvent.click(screen.getByRole("button", { name: CONVERSATION_TAG_PRESET_COLORS[4] }));
		fireEvent.click(screen.getByRole("button", { name: "Create" }));

		expect(props.onCreate).toHaveBeenCalledWith({ name: "紧急", color: CONVERSATION_TAG_PRESET_COLORS[4] });
		expect(props.onClose).toHaveBeenCalledOnce();
	});

	it("refuses a blank name instead of creating an unnamed tag", () => {
		const props = renderDialog();
		fireEvent.change(screen.getByPlaceholderText("Tag name"), { target: { value: "   " } });
		fireEvent.click(screen.getByRole("button", { name: "Create" }));

		expect(props.onCreate).not.toHaveBeenCalled();
		expect(screen.getByRole("alert").textContent).toBe("Enter a tag name");
	});

	it("does not submit while an IME composition is in flight", () => {
		const props = renderDialog();
		const input = screen.getByPlaceholderText("Tag name");
		fireEvent.change(input, { target: { value: "紧急" } });
		fireEvent.compositionStart(input);
		fireEvent.keyDown(input, { key: "Enter" });

		expect(props.onCreate).not.toHaveBeenCalled();
	});

	it("renames, recolours and deletes from the manage list", () => {
		const props = renderDialog({
			mode: "manage",
			tags: [{ id: "t1", name: "重要", color: "#ff5f57", removeHint: "Removes it from 2 conversations" }],
		});

		const nameInput = screen.getByDisplayValue("重要");
		fireEvent.blur(nameInput, { target: { value: "紧急" } });
		expect(props.onRename).toHaveBeenCalledWith({ id: "t1", name: "紧急" });

		fireEvent.click(screen.getByRole("button", { name: "Delete tag 重要" }));
		expect(props.onRemove).toHaveBeenCalledWith("t1");
	});

	it("offers the new-tag form from the manage list without closing the dialog", () => {
		const props = renderDialog({ mode: "manage", tags: [] });
		expect(screen.queryByPlaceholderText("Tag name")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "New tag" }));
		fireEvent.change(screen.getByPlaceholderText("Tag name"), { target: { value: "待办" } });
		fireEvent.click(screen.getByRole("button", { name: "Create" }));

		expect(props.onCreate).toHaveBeenCalledWith({ name: "待办", color: CONVERSATION_TAG_PRESET_COLORS[0] });
		expect(props.onClose).not.toHaveBeenCalled();
	});
});
