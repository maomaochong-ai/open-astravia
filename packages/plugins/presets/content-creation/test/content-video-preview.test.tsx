// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentVideoPreview } from "../src/node/ContentVideoPreview";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@vetta/ui", () => ({
	Slider: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) => (
		<input type="range" aria-label={ariaLabel} />
	),
}));

describe("ContentVideoPreview", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("keeps the video surface available to React Flow dragging", () => {
		const onPointerDown = vi.fn();
		const { container } = render(
			<div onPointerDown={onPointerDown}>
				<ContentVideoPreview src="data:video/mp4;base64,AAAA" />
			</div>,
		);
		const video = container.querySelector("video");
		const controls = container.querySelector("[data-content-video-controls]");

		expect(video).not.toBeNull();
		expect(video?.classList.contains("pointer-events-none")).toBe(true);
		expect(video?.classList.contains("nodrag")).toBe(false);
		expect(controls?.classList.contains("nodrag")).toBe(true);
		expect(controls?.classList.contains("nowheel")).toBe(true);
		if (video) fireEvent.pointerDown(video);
		expect(onPointerDown).toHaveBeenCalledOnce();
	});

	it("uses the custom play button instead of native controls", () => {
		const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
		const { container } = render(<ContentVideoPreview src="data:video/mp4;base64,AAAA" />);

		expect(container.querySelector("video")?.controls).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "action.play" }));
		expect(play).toHaveBeenCalledOnce();
	});
});
