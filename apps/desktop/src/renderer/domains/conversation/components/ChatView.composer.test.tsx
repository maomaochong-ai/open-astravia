// @vitest-environment jsdom

import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const connectorRender = vi.hoisted(() => vi.fn());

vi.mock("./input-bar/DefaultInputBarConnector", () => ({
	DefaultInputBarConnector: () => {
		connectorRender();
		return <div>composer</div>;
	},
}));

vi.mock("./chat-view/DefaultChatView", () => ({
	ChatComposer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DefaultChatView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { DefaultChatComposer } from "./ChatView";

describe("DefaultChatComposer", () => {
	it("does not redraw when the surrounding message view rerenders with stable actions", () => {
		const props = {
			onAbort: vi.fn(async () => undefined),
			onSend: vi.fn(async () => undefined),
			onSendQueued: vi.fn(async () => undefined),
			cwdOverride: "C:/workspace",
		};
		const { rerender } = render(<DefaultChatComposer {...props} />);
		expect(connectorRender).toHaveBeenCalledTimes(1);

		rerender(<DefaultChatComposer {...props} />);
		expect(connectorRender).toHaveBeenCalledTimes(1);

		rerender(<DefaultChatComposer {...props} cwdOverride="C:/other" />);
		expect(connectorRender).toHaveBeenCalledTimes(2);
	});
});
