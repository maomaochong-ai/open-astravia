// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ManualMcpDialog } from "./ManualMcpDialog";
import { McpEditDialog } from "./McpEditDialog";
import { useMcpSettingsModel } from "./useMcpSettingsModel";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function Harness() {
	const model = useMcpSettingsModel();
	return (
		<>
			<button type="button" onClick={model.onStartAddServer}>
				add
			</button>
			<button type="button" onClick={() => model.onToggleEditServer("remote")}>
				edit
			</button>
			<ManualMcpDialog model={model} />
			<McpEditDialog model={model} />
		</>
	);
}

it("adds an HTTP MCP, reopens it, and keeps the key and manual headers synchronized", async () => {
	const user = userEvent.setup();
	const set = vi.fn(async () => undefined);
	(window as unknown as { vetta: unknown }).vetta = {
		mcp: { get: async () => ({ mcpServers: {} }), set, authStatus: async () => ({}) },
	};
	render(<Harness />);
	await user.click(screen.getByRole("button", { name: "add" }));
	// Transport is available while advanced options are collapsed.
	expect(screen.getByRole("button", { name: "advancedOptions" }).getAttribute("aria-expanded")).toBe("false");
	await user.click(screen.getByRole("button", { name: "HTTP" }));
	await user.type(screen.getByRole("textbox", { name: "serverName" }), "remote");
	await user.type(screen.getByRole("textbox", { name: "sseUrl" }), "https://example.com/mcp");
	await user.type(screen.getByLabelText("mcpStore.authorizationKey"), "Bearer first=token");
	await user.click(screen.getByRole("button", { name: "addServer" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(set).toHaveBeenLastCalledWith({
		mcpServers: {
			remote: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer first=token" } },
		},
	});
	await user.click(screen.getByRole("button", { name: "edit" }));
	expect((screen.getByLabelText("mcpStore.authorizationKey") as HTMLInputElement).value).toBe("Bearer first=token");
	const headers = screen.getByLabelText("requestHeaders");
	await user.clear(headers);
	await user.type(headers, "authorization=manual\nX-Custom=keep");
	expect((screen.getByLabelText("mcpStore.authorizationKey") as HTMLInputElement).value).toBe("manual");
	await user.clear(screen.getByLabelText("mcpStore.authorizationKey"));
	await user.click(screen.getByRole("button", { name: "save" }));
	await waitFor(() =>
		expect(set).toHaveBeenLastCalledWith({
			mcpServers: { remote: { type: "http", url: "https://example.com/mcp", headers: { "X-Custom": "keep" } } },
		}),
	);
});
