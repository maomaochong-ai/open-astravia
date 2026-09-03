// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pendingMcpElicitationsAtom } from "@shared/store/atoms";
import type { DesktopMcpElicitationRequest } from "@preload/api";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

const { McpElicitationPanel } = await import("./McpElicitationPanel.js");

describe("McpElicitationPanel", () => {
	const respondToMcpElicitation = vi.fn(async () => undefined);
	const openExternal = vi.fn(async () => undefined);

	beforeEach(() => {
		vi.clearAllMocks();
		getDefaultStore().set(pendingMcpElicitationsAtom, {});
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				session: { respondToMcpElicitation },
				shell: { openExternal },
			},
		});
	});

	it("submits validated form values and removes the pending request", async () => {
		const user = userEvent.setup();
		const request: DesktopMcpElicitationRequest = {
			requestId: "request-1",
			sessionId: "session-1",
			serverName: "demo",
			mode: "form",
			message: "Configure connector",
			fields: [
				{ key: "name", kind: "string", title: "Name", required: true },
				{ key: "retries", kind: "integer", title: "Retries", required: false },
			],
		};
		getDefaultStore().set(pendingMcpElicitationsAtom, { "session-1": request });
		render(<McpElicitationPanel request={request} />);

		await user.type(screen.getByRole("textbox", { name: "Name" }), "Vetta");
		await user.click(screen.getByRole("button", { name: "mcpElicitation.submit" }));

		await waitFor(() =>
			expect(respondToMcpElicitation).toHaveBeenCalledWith("request-1", {
				action: "accept",
				content: { name: "Vetta" },
			}),
		);
		expect(getDefaultStore().get(pendingMcpElicitationsAtom)).toEqual({});
	});

	it("opens a URL only after consent and then accepts", async () => {
		const user = userEvent.setup();
		const request: DesktopMcpElicitationRequest = {
			requestId: "request-2",
			sessionId: "session-1",
			serverName: "demo",
			mode: "url",
			message: "Authenticate",
			url: "https://example.com/authorize",
		};
		render(<McpElicitationPanel request={request} />);

		await user.click(screen.getByRole("button", { name: "mcpElicitation.openAndContinue" }));

		await waitFor(() => expect(openExternal).toHaveBeenCalledWith(request.url));
		expect(respondToMcpElicitation).toHaveBeenCalledWith("request-2", { action: "accept" });
		expect(openExternal.mock.invocationCallOrder[0]).toBeLessThan(
			respondToMcpElicitation.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
		);
	});
});
