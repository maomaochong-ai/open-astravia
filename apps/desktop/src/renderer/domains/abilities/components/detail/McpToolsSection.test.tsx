// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AbilitiesModel, McpAbility } from "../../types";
import { McpToolsSection } from "./McpToolsSection";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const paint = vi.hoisted(() => ({ wait: vi.fn(async () => "painted") }));
vi.mock("@shared/lib/committed-paint", () => ({ waitForCommittedPaint: paint.wait }));
const item = {
	type: "mcp",
	id: "mcp:remote",
	serverName: "remote",
	installed: true,
	enabled: true,
	setupRequired: false,
} as McpAbility;
const model = { mcp: { config: null } } as AbilitiesModel;

function api(listTools: ReturnType<typeof vi.fn>) {
	(window as unknown as { vetta: unknown }).vetta = { mcp: { listTools } };
}

describe("McpToolsSection", () => {
	it("shows the shell before discovery, then all names and full descriptions", async () => {
		let release = () => {};
		paint.wait.mockReturnValueOnce(
			new Promise<string>((resolve) => {
				release = () => resolve("painted");
			}),
		);
		const description = "A long description. ".repeat(100);
		const listTools = vi.fn(async () => [{ name: "search", description }, { name: "read" }]);
		api(listTools);
		render(<McpToolsSection item={item} model={model} />);
		expect(screen.getByRole("heading", { name: "mcp.tools.title" })).toBeDefined();
		expect(screen.getByRole("status").textContent).toBe("mcp.tools.loading");
		expect(listTools).not.toHaveBeenCalled();
		await act(async () => release());
		await screen.findByRole("heading", { name: "search" });
		expect(screen.getByRole("heading", { name: "read" })).toBeDefined();
		expect(screen.getByText(description.trim()).textContent).toBe(description);
		expect(screen.getByText("mcp.tools.noDescription")).toBeDefined();
	});
	it("shows the connection error directly and clears it after retry", async () => {
		api(
			vi
				.fn()
				.mockRejectedValueOnce(new Error("offline"))
				.mockResolvedValueOnce([{ name: "ready", description: "Connected" }]),
		);
		render(<McpToolsSection item={item} model={model} />);
		expect((await screen.findByRole("alert")).textContent).toContain("offline");
		await userEvent.setup().click(screen.getByRole("button", { name: "mcp.tools.retry" }));
		await screen.findByRole("heading", { name: "ready" });
		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.queryByText("offline")).toBeNull();
	});
	it("displays string errors as text and falls back for errors without a message", async () => {
		api(vi.fn().mockRejectedValueOnce("HTTP 401\nAuthorization required").mockRejectedValueOnce(null));
		render(<McpToolsSection item={item} model={model} />);
		expect((await screen.findByRole("alert")).textContent).toContain("HTTP 401\nAuthorization required");
		await userEvent.setup().click(screen.getByRole("button", { name: "mcp.tools.retry" }));
		await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("mcp.tools.error"));
	});

	it("does not connect disabled servers and ignores stale results after switching MCP", async () => {
		let release = () => {};
		const listTools = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						release = () => resolve([{ name: "old" }]);
					}),
			)
			.mockResolvedValueOnce([{ name: "new" }]);
		api(listTools);
		const { rerender } = render(<McpToolsSection item={{ ...item, enabled: false }} model={model} />);
		expect(screen.getByText("mcp.tools.enableFirst")).toBeDefined();
		expect(listTools).not.toHaveBeenCalled();
		rerender(<McpToolsSection item={item} model={model} />);
		await waitFor(() => expect(listTools).toHaveBeenCalledWith("remote"));
		rerender(<McpToolsSection item={{ ...item, serverName: "second" }} model={model} />);
		await screen.findByRole("heading", { name: "new" });
		await act(async () => release());
		expect(screen.queryByRole("heading", { name: "old" })).toBeNull();
	});
});
