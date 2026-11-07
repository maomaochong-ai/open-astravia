// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	InputBarAttachmentActions,
	InputBarSendAction,
	InputBarSpeechAction,
} from "./InputBarToolbar";

vi.mock("./InputBarToolbarButton", () => ({
	InputBarToolbarButton: ({ title, onClick }: { title: string; onClick: () => void }) => (
		<button type="button" onClick={onClick}>
			{title}
		</button>
	),
}));
vi.mock("../SendButton", () => ({
	SendButton: ({ onSend }: { onSend: () => void }) => (
		<button type="button" onClick={onSend}>
			Send
		</button>
	),
}));

afterEach(cleanup);

describe("InputBar toolbar abilities", () => {
	it("keeps image and file attachment actions independently callable", () => {
		const onSelectImages = vi.fn();
		const onSelectFiles = vi.fn();
		render(
			<InputBarAttachmentActions
				disabled={false}
				visible
				addImageTitle="Add image"
				attachFileTitle="Attach file"
				onSelectImages={onSelectImages}
				onSelectFiles={onSelectFiles}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add image" }));
		fireEvent.click(screen.getByRole("button", { name: "Attach file" }));
		expect(onSelectImages).toHaveBeenCalledOnce();
		expect(onSelectFiles).toHaveBeenCalledOnce();
	});

	it("renders speech input only when that ability is available", () => {
		const onToggle = vi.fn();
		const input = {
			visible: false,
			active: false,
			disabled: false,
			title: "Dictate",
			statusText: null,
			onToggle,
		};
		const view = render(<InputBarSpeechAction input={input} />);
		expect(screen.queryByRole("button", { name: "Dictate" })).toBeNull();

		view.rerender(<InputBarSpeechAction input={{ ...input, visible: true }} />);
		fireEvent.click(screen.getByRole("button", { name: "Dictate" }));
		expect(onToggle).toHaveBeenCalledOnce();
	});

	it("preserves queue and normal send actions as separate states", () => {
		const onSend = vi.fn();
		const view = render(
			<InputBarSendAction
				canSend
				isEmpty={false}
				isStreaming
				queueTitle="Queue"
				guideTitle="Guide"
				onAbort={vi.fn()}
				onSend={onSend}
				onGuide={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Queue" }));
		expect(onSend).toHaveBeenCalledOnce();

		view.rerender(
			<InputBarSendAction
				canSend
				isEmpty
				isStreaming={false}
				queueTitle="Queue"
				guideTitle="Guide"
				onAbort={vi.fn()}
				onSend={onSend}
				onGuide={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
	});

	it("offers guidance that injects into the running turn without queueing", () => {
		// 引导（steer）与队列（followUp）是两种行为，按钮必须分开，否则用户没法在模型输出中途改方向。
		const onSend = vi.fn();
		const onGuide = vi.fn();
		render(
			<InputBarSendAction
				canSend
				isEmpty={false}
				isStreaming
				queueTitle="Queue"
				guideTitle="Guide"
				onAbort={vi.fn()}
				onSend={onSend}
				onGuide={onGuide}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Guide" }));
		expect(onGuide).toHaveBeenCalledOnce();
		expect(onSend).not.toHaveBeenCalled();
	});
});
