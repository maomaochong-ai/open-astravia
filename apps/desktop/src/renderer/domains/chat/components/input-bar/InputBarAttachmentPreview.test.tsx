// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputBarAttachmentPreview } from "./InputBarAttachmentPreview";

afterEach(cleanup);

describe("InputBarAttachmentPreview", () => {
	it("keeps edit and image actions attached to the preview ability", () => {
		const onCancelPendingEdit = vi.fn();
		const onOpenImagePreview = vi.fn();
		const onRemoveImage = vi.fn();
		render(
			<InputBarAttachmentPreview
				open
				renderContent
				pendingMessageEdit
				pendingEditHint="Editing the previous message"
				cancelPendingEditLabel="Cancel edit"
				appshotAttachment={null}
				images={[{ path: "C:/diagram.png", name: "diagram.png", url: "image-url", label: "Image 1" }]}
				removeImageLabel="Remove image"
				onCancelPendingEdit={onCancelPendingEdit}
				onRemoveAppshot={vi.fn()}
				onOpenImagePreview={onOpenImagePreview}
				onRemoveImage={onRemoveImage}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
		fireEvent.click(screen.getByRole("button", { name: "diagram.png" }));
		fireEvent.click(screen.getByRole("button", { name: "Remove image" }));

		expect(onCancelPendingEdit).toHaveBeenCalledOnce();
		expect(onOpenImagePreview).toHaveBeenCalledWith(0);
		expect(onRemoveImage).toHaveBeenCalledWith("C:/diagram.png");
	});

	it("retains the collapsing shell while its content is unmounted", () => {
		const view = render(
			<InputBarAttachmentPreview
				open={false}
				renderContent={false}
				pendingMessageEdit={false}
				pendingEditHint=""
				cancelPendingEditLabel="Cancel edit"
				appshotAttachment={null}
				images={[]}
				removeImageLabel="Remove image"
				onCancelPendingEdit={vi.fn()}
				onRemoveAppshot={vi.fn()}
				onOpenImagePreview={vi.fn()}
				onRemoveImage={vi.fn()}
			/>,
		);

		expect(view.container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
		expect(screen.queryByRole("button")).toBeNull();
	});
});
