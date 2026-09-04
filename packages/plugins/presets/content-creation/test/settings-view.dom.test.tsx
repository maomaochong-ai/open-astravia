// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentSettingsStore } from "../src/settings/content-settings";
import { ContentSettingsView } from "../src/settings/SettingsView";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

function createStore(secrets = new Map<string, string>()) {
	const json = new Map<string, unknown>();
	const writeSecret = vi.fn(async (key: string, value: string) => {
		if (value) secrets.set(key, value);
		else secrets.delete(key);
	});
	const writeJson = vi.fn(async (key: string, value: unknown) => {
		json.set(key, value);
	});
	const store = new ContentSettingsStore({
		readJson: async (key) => json.get(key) ?? null,
		writeJson,
		readSecret: async (key) => secrets.get(key),
		writeSecret,
	});
	return { store, writeSecret, writeJson };
}

afterEach(cleanup);

describe("ContentSettingsView", () => {
	it("shows a saved secret as a state, never as a value", async () => {
		const { store } = createStore(new Map([["openaiApiKey", "sk-live-secret"]]));
		render(<ContentSettingsView store={store} />);

		await waitFor(() => expect(screen.getAllByText("settings.secret.saved").length).toBeGreaterThan(0));
		expect(document.body.innerHTML).not.toContain("sk-live-secret");
		for (const input of screen.getAllByDisplayValue("")) {
			expect(input).toBeTruthy();
		}
	});

	it("writes a typed secret through the vault port and clears the input", async () => {
		const { store, writeSecret } = createStore();
		render(<ContentSettingsView store={store} />);
		await waitFor(() => expect(screen.getAllByText("settings.secret.empty").length).toBe(4));

		const [secretInput] = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
		if (!secretInput) throw new Error("secret input not rendered");
		fireEvent.change(secretInput, { target: { value: "sk-new" } });
		fireEvent.click(screen.getAllByText("settings.secret.save")[0] as HTMLElement);

		await waitFor(() => expect(writeSecret).toHaveBeenCalledWith("openaiApiKey", "sk-new"));
		expect(secretInput.value).toBe("");
	});

	it("commits a plain field on blur, not on every keystroke", async () => {
		const { store, writeJson } = createStore();
		render(<ContentSettingsView store={store} />);
		await waitFor(() => expect(screen.getByText("settings.openaiModel.title")).toBeTruthy());

		const modelInput = document.querySelectorAll<HTMLInputElement>('input:not([type="password"])')[0];
		if (!modelInput) throw new Error("plain input not rendered");
		fireEvent.change(modelInput, { target: { value: "gpt-image-3" } });
		expect(writeJson).not.toHaveBeenCalled();

		fireEvent.blur(modelInput);
		await waitFor(() =>
			expect(writeJson).toHaveBeenCalledWith("settings", expect.objectContaining({ openaiModel: "gpt-image-3" })),
		);
	});
});
