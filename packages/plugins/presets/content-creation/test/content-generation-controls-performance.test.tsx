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
}

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@vetta/ui", () => ({
	Button: ({ children, size: _size, variant: _variant, ...props }: MockButtonProps) => (
		<button {...props}>{children}</button>
	),
	Select: ({ children, open, onOpenChange }: MockSelectProps) => (
		<div>
			<button type="button" data-testid="select-toggle" onClick={() => onOpenChange?.(!open)}>
				toggle
			</button>
			{children}
		</div>
	),
	SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: ReactNode }) => <div data-testid="select-item">{children}</div>,
	SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectValue: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
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
	modes: [],
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

	it("mounts video duration options only after the duration select opens", () => {
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

		expect(screen.queryAllByTestId("select-item")).toHaveLength(0);

		fireEvent.click(screen.getAllByTestId("select-toggle")[1]);

		expect(screen.getAllByTestId("select-item")).toHaveLength(videoModel.durations?.length);
	});
});
