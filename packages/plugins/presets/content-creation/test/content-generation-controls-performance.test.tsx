// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentGenerationControls } from "../src/node/ContentGenerationControls";
import type { ContentModelDescriptor } from "../src/generation/types";

interface MockButtonProps extends ComponentProps<"button"> {
	size?: string;
	variant?: string;
}

interface MockSelectProps {
	children: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onValueChange?: (value: string) => void;
}

interface MockPopoverProps {
	children: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@vetta/ui", () => ({
	Button: ({ children, size: _size, variant: _variant, ...props }: MockButtonProps) => (
		<button {...props}>{children}</button>
	),
	Select: ({ children, open, onOpenChange, onValueChange }: MockSelectProps) => (
		<div>
			<button type="button" data-testid="select-toggle" onClick={() => onOpenChange?.(!open)}>
				toggle
			</button>
			<button type="button" data-testid="select-automatic" onClick={() => onValueChange?.("__automatic__")}>
				automatic
			</button>
			{children}
		</div>
	),
	SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: ReactNode }) => <div data-testid="select-item">{children}</div>,
	SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectValue: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
	Popover: ({ children, open, onOpenChange }: MockPopoverProps) => (
		<div>
			<button type="button" data-testid="popover-toggle" onClick={() => onOpenChange?.(!open)}>
				popover
			</button>
			{children}
		</div>
	),
	PopoverTrigger: ({ children }: { children: ReactNode }) => children,
	PopoverContent: ({ children }: { children: ReactNode }) => <div data-testid="video-settings-panel">{children}</div>,
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

describe("ContentGenerationControls option mounting", () => {
	afterEach(cleanup);

	it("mounts image options only after their select opens", () => {
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

		expect(screen.queryAllByTestId("select-item")).toHaveLength(0);
		expect(screen.getByText("provider.test · Image A")).toBeTruthy();

		fireEvent.click(screen.getAllByTestId("select-toggle")[0]);

		expect(screen.getAllByTestId("select-item")).toHaveLength(imageModels.length);
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

		fireEvent.click(screen.getByTestId("popover-toggle"));

		expect(screen.getByTestId("video-settings-panel")).toBeTruthy();
		expect(screen.getByText("nodeEditor.videoSettings.method.frames")).toBeTruthy();
		expect(screen.getByText("nodeEditor.videoSettings.method.omni").closest("button")).toHaveProperty("disabled", true);
		expect(screen.getByText("option.resolution.720p")).toBeTruthy();
		expect(screen.getAllByText("option.duration.seconds")).toHaveLength(videoModel.durations?.length ?? 0);
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
		fireEvent.click(screen.getByText("nodeEditor.videoSettings.followImage"));

		expect(onChange).toHaveBeenCalledWith({ aspectRatio: undefined, duration: 5, resolution: "720p" });
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
});
