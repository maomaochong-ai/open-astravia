// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode, Ref } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentGenerationControls } from "../src/node/ContentGenerationControls";
import type { ContentModelDescriptor } from "../src/generation/types";

interface MockButtonProps extends ComponentProps<"button"> {
	size?: string;
	variant?: string;
}

interface MockDropdownMenuProps {
	children: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	modal?: boolean;
}

interface MockPopoverProps {
	children: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	modal?: boolean;
}

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@vetta/ui", () => ({
	Button: ({ children, size: _size, variant: _variant, ...props }: MockButtonProps) => (
		<button {...props}>{children}</button>
	),
	DropdownMenu: ({ children, open, onOpenChange, modal }: MockDropdownMenuProps) => (
		<div data-testid="menu-root" data-open={open ? "true" : "false"} data-modal={modal ? "true" : "false"}>
			<button type="button" data-testid="menu-toggle" onClick={() => onOpenChange?.(!open)}>
				toggle
			</button>
			{children}
		</div>
	),
	DropdownMenuContent: ({ children, ref }: { children: ReactNode; ref?: Ref<HTMLDivElement> }) => (
		<div ref={ref}>{children}</div>
	),
	DropdownMenuRadioGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DropdownMenuRadioItem: ({ children }: { children: ReactNode }) => <div data-testid="menu-item">{children}</div>,
	DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div data-testid="menu-trigger">{children}</div>,
	Popover: ({ children, open, onOpenChange, modal }: MockPopoverProps) => (
		<div data-testid="popover-root" data-modal={modal ? "true" : "false"}>
			<button type="button" data-testid="popover-toggle" onClick={() => onOpenChange?.(!open)}>
				popover
			</button>
			<button type="button" data-testid="popover-dismiss" onClick={() => onOpenChange?.(false)}>
				dismiss
			</button>
			{children}
		</div>
	),
	PopoverTrigger: ({ children }: { children: ReactNode }) => children,
	PopoverContent: ({ children, className, ref }: { children: ReactNode; className?: string; ref?: Ref<HTMLDivElement> }) => (
		<div ref={ref} data-testid="video-settings-panel" className={className}>
			{children}
		</div>
	),
}));

const imageModels: readonly ContentModelDescriptor[] = [
	{
		providerId: "test",
		modelId: "image-a",
		displayName: "Image A",
		outputKind: "image",
		aspectRatios: ["1:1", "16:9"],
		modes: [],
	},
	{
		providerId: "test",
		modelId: "image-b",
		displayName: "Image B",
		outputKind: "image",
		aspectRatios: ["1:1"],
		modes: [],
	},
	{
		providerId: "test",
		modelId: "image-c",
		displayName: "Image C",
		outputKind: "image",
		aspectRatios: ["1:1"],
		modes: [],
	},
];

const videoModel: ContentModelDescriptor = {
	providerId: "test",
	modelId: "video-a",
	displayName: "Video A",
	outputKind: "video",
	aspectRatios: [],
	durations: [5, 10],
	resolutions: ["720p", "1080p"],
	modes: [
		{
			id: "image-to-video",
			inputs: [{ id: "referenceImages", accepts: ["image"], minItems: 1, maxItems: 1 }],
		},
	],
};

function pointerDownOnCanvasBlank(): void {
	const blank = document.createElement("div");
	blank.addEventListener("pointerdown", (event) => event.stopPropagation());
	document.body.append(blank);
	fireEvent.pointerDown(blank);
	blank.remove();
}

describe("ContentGenerationControls option mounting", () => {
	afterEach(cleanup);

	it("mounts image options only after their menu opens", () => {
		render(
			<ContentGenerationControls
				kind="image-generator"
				draft={{ aspectRatio: "1:1", quality: "standard" }}
				models={imageModels}
				selectedModel={imageModels[0]}
				isRunning={false}
				canGenerate
				onChange={vi.fn()}
				onModelChange={vi.fn()}
				onSubmit={vi.fn()}
			/>,
		);

		expect(screen.queryAllByTestId("menu-item")).toHaveLength(0);
		expect(screen.getByText("provider.test · Image A")).toBeTruthy();

		fireEvent.click(screen.getAllByTestId("menu-toggle")[0]);

		expect(screen.getAllByTestId("menu-item")).toHaveLength(imageModels.length);
		pointerDownOnCanvasBlank();
		expect(screen.queryAllByTestId("menu-item")).toHaveLength(0);
	});

	it("mounts the grouped video settings panel only after its summary opens", () => {
		render(
			<ContentGenerationControls
				kind="video-generator"
				draft={{ duration: 5, resolution: "720p" }}
				models={[videoModel]}
				selectedModel={videoModel}
				isRunning={false}
				canGenerate
				onChange={vi.fn()}
				onModelChange={vi.fn()}
				onSubmit={vi.fn()}
			/>,
		);

		expect(screen.queryByTestId("video-settings-panel")).toBeNull();
		expect(screen.getAllByTestId("menu-toggle")).toHaveLength(1);
		expect(screen.getByTestId("menu-root").getAttribute("data-modal")).toBe("false");
		expect(screen.getByTestId("popover-root").getAttribute("data-modal")).toBe("false");
		expect(screen.getByLabelText("nodeEditor.videoSettings.open").className).toContain("h-7");
		expect(screen.getByLabelText("nodeEditor.videoSettings.open").className).toContain("border-0");
		expect(screen.getByLabelText("nodeEditor.videoSettings.open").className).not.toContain("pointer-events-auto");
		fireEvent.click(screen.getByTestId("menu-toggle"));
		expect(screen.getAllByTestId("menu-item")).toHaveLength(1);
		fireEvent.pointerDown(screen.getByLabelText("nodeEditor.videoSettings.open"));
		expect(screen.queryAllByTestId("menu-item")).toHaveLength(0);
		fireEvent.click(screen.getByTestId("popover-toggle"));

		expect(screen.getByTestId("video-settings-panel").className).toContain("bg-popover");
		expect(screen.getByLabelText("nodeEditor.videoSettings.open").className).toContain("bg-transparent");
		expect(screen.getByText("nodeEditor.videoSettings.method.frames")).toBeTruthy();
		expect(screen.getByText("nodeEditor.videoSettings.method.omni").closest("button")).toHaveProperty("disabled", true);
		expect(screen.getByText("option.resolution.720p")).toBeTruthy();
		expect(screen.getAllByText("option.duration.seconds")).toHaveLength(videoModel.durations?.length ?? 0);
		fireEvent.pointerDown(screen.getByText("nodeEditor.videoSettings.method.frames"));
		expect(screen.getByTestId("video-settings-panel")).toBeTruthy();
		pointerDownOnCanvasBlank();
		expect(screen.queryByTestId("video-settings-panel")).toBeNull();
	});

	it("clears an explicit video ratio when follow-image mode is selected", () => {
		const onChange = vi.fn();
		const model = { ...videoModel, aspectRatios: ["16:9", "9:16"] };
		render(
			<ContentGenerationControls
				kind="video-generator"
				draft={{ aspectRatio: "16:9", duration: 5, resolution: "720p" }}
				models={[model]}
				selectedModel={model}
				resolvedAspectRatio="9:16"
				isRunning={false}
				canGenerate
				onChange={onChange}
				onModelChange={vi.fn()}
				onSubmit={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByTestId("popover-toggle"));
		expect(screen.getAllByTestId("menu-toggle")).toHaveLength(1);
		const automaticRatio = screen.getByText("nodeEditor.videoSettings.followImageShort").closest("button");
		expect(automaticRatio?.parentElement?.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
		expect(automaticRatio?.className).toContain("bg-accent");
		fireEvent.click(automaticRatio as HTMLButtonElement);

		expect(onChange).toHaveBeenCalledWith({ aspectRatio: undefined, duration: 5, resolution: "720p" });
	});

	it("omits a stale resolution from the summary when the model does not expose resolutions", () => {
		const model: ContentModelDescriptor = { ...videoModel, aspectRatios: ["16:9", "9:16"], resolutions: [] };
		render(
			<ContentGenerationControls
				kind="video-generator"
				draft={{ duration: 5, resolution: "720p" }}
				models={[model]}
				selectedModel={model}
				resolvedAspectRatio="9:16"
				isRunning={false}
				canGenerate
				onChange={vi.fn()}
				onModelChange={vi.fn()}
				onSubmit={vi.fn()}
			/>,
		);

		expect(screen.getByLabelText("nodeEditor.videoSettings.open").textContent).not.toContain("720p");
	});

	it("switches to omni reference when the selected model supports it", () => {
		const onChange = vi.fn();
		const model: ContentModelDescriptor = {
			...videoModel,
			modes: [
				...videoModel.modes,
				{
					id: "reference-to-video",
					inputs: [{ id: "referenceImages", accepts: ["image"], minItems: 1, maxItems: 8 }],
				},
			],
		};
		render(
			<ContentGenerationControls
				kind="video-generator"
				draft={{ modeId: "image-to-video", duration: 5, resolution: "720p" }}
				models={[model]}
				selectedModel={model}
				isRunning={false}
				canGenerate
				onChange={onChange}
				onModelChange={vi.fn()}
				onSubmit={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByTestId("popover-toggle"));
		fireEvent.click(screen.getByText("nodeEditor.videoSettings.method.omni"));

		expect(onChange).toHaveBeenCalledWith({
			modeId: "reference-to-video",
			duration: 5,
			resolution: "720p",
		});
	});

	it("uses input-derived ratio and always-on audio for a declared frame capability", () => {
		const model: ContentModelDescriptor = {
			...videoModel,
			aspectRatios: ["16:9", "9:16"],
			modes: [
				{
					id: "image-to-video",
					inputs: [
						{ id: "firstFrame", accepts: ["image"], minItems: 0, maxItems: 1 },
						{ id: "lastFrame", accepts: ["image"], minItems: 0, maxItems: 1 },
					],
					minTotalItems: 1,
					aspectRatioPolicy: "input-derived",
					audioGeneration: "always",
				},
			],
		};
		render(
			<ContentGenerationControls
				kind="video-generator"
				draft={{ modeId: "image-to-video", aspectRatio: "16:9", duration: 5 }}
				models={[model]}
				selectedModel={model}
				isRunning={false}
				canGenerate
				onChange={vi.fn()}
				onModelChange={vi.fn()}
				onSubmit={vi.fn()}
			/>,
		);

		expect(screen.getByLabelText("nodeEditor.videoSettings.open").textContent).toContain(
			"nodeEditor.videoSettings.followImageShort",
		);
		expect(screen.getByLabelText("nodeEditor.videoSettings.open").textContent).not.toContain("16:9");
		fireEvent.click(screen.getByTestId("popover-toggle"));
		expect(screen.getByText("nodeEditor.videoSettings.followImageShort").closest("button")?.parentElement?.style.gridTemplateColumns).toBe(
			"repeat(1, minmax(0, 1fr))",
		);
		expect(screen.getByText("nodeEditor.videoSettings.audio.on").closest("button")?.className).toContain("bg-accent");
	});
});
