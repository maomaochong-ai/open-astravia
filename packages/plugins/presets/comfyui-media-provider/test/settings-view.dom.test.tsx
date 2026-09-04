// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "../src/components/SettingsView";
import { ProviderSettingsStore } from "../src/settings/provider-settings";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

function createPorts(probeResult: { ok: boolean; detail?: string } = { ok: true }) {
	let stored: unknown = { baseUrl: "http://comfy.local:8188" };
	const writeJson = vi.fn(async (_key: string, value: unknown) => {
		stored = value;
	});
	const store = new ProviderSettingsStore({ readJson: async () => stored, writeJson });
	const probe = vi.fn(async () => probeResult as never);
	return { store, writeJson, probe, ports: { store, probe } };
}

afterEach(cleanup);

describe("ComfyUI SettingsView", () => {
	it("shows the stored base URL once loaded", async () => {
		const { ports } = createPorts();
		render(<SettingsView ports={ports} />);

		await waitFor(() => expect(screen.getByDisplayValue("http://comfy.local:8188")).toBeTruthy());
	});

	it("commits an edited field on blur", async () => {
		const { ports, writeJson } = createPorts();
		render(<SettingsView ports={ports} />);
		const input = await screen.findByDisplayValue("http://comfy.local:8188");

		fireEvent.change(input, { target: { value: "http://other:8188" } });
		expect(writeJson).not.toHaveBeenCalled();

		fireEvent.blur(input);
		await waitFor(() =>
			expect(writeJson).toHaveBeenCalledWith("settings", expect.objectContaining({ baseUrl: "http://other:8188" })),
		);
	});

	it("reports a failed probe with its detail instead of claiming success", async () => {
		const { ports, probe } = createPorts({ ok: false, detail: "HTTP 502" });
		render(<SettingsView ports={ports} />);
		await screen.findByDisplayValue("http://comfy.local:8188");

		fireEvent.click(screen.getByText("settings.connection.test"));

		await waitFor(() => expect(screen.getByText("settings.connection.failed")).toBeTruthy());
		expect(probe).toHaveBeenCalledWith("http://comfy.local:8188");
		expect(screen.getByText("HTTP 502")).toBeTruthy();
	});

	it("surfaces a thrown probe error rather than leaving the page in checking", async () => {
		const { store } = createPorts();
		render(
			<SettingsView
				ports={{
					store,
					probe: async () => {
						throw new Error("network down");
					},
				}}
			/>,
		);
		await screen.findByDisplayValue("http://comfy.local:8188");

		fireEvent.click(screen.getByText("settings.connection.test"));

		await waitFor(() => expect(screen.getByText("settings.connection.failed")).toBeTruthy());
	});
});
