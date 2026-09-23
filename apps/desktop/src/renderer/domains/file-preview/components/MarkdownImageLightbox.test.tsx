// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FilePreviewDialogView } from "@vetta-org/theme-ui/file-preview";
import { afterEach, expect, it, vi } from "vitest";

afterEach(cleanup);
it("opens generated SVG as an image and retains its vector filename when saving from the lightbox", () => {
	const item = { name: "Diagram.svg", url: "data:image/svg+xml,%3Csvg/%3E", kind: "image" as const };
	const save = vi.fn();
	render(<FilePreviewDialogView context={{ items: [item], index: 0 }} item={item} isImageGroup={false}
		labels={{ close: "Close", download: "Save", showInFolder: "Show in folder" }}
		onClose={vi.fn()} onDownload={save} onGoNext={vi.fn()} onGoPrev={vi.fn()} onSelectIndex={vi.fn()} onShowInFolder={vi.fn()}
		lightbox={<img src={item.url} alt="Diagram" />} previewBody={<span>File source</span>} />);
	expect(screen.getByRole("img", { name: "Diagram" })).toBeTruthy();
	expect(screen.queryByText("File source")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	expect(save).toHaveBeenCalledWith(item);
});
