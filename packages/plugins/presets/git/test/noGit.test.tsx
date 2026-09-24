// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitPanel } from "../src/components/GitPanel";
import { GitSettingsView } from "../src/components/GitSettingsView";
import { setAiApi, setGitCommand, setStorageApi } from "../src/git/runtime";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key, locale: "en" }),
	useActivityTab: () => ({ cwd: "/repo" }),
}));

afterEach(() => {
	cleanup();
});

/** 模拟宿主：installed=false 时 git 一律起不来，与宿主报告「没装 git」一致。 */
function host() {
	const state = { installed: false };
	const run = vi.fn(async (_file: string, args: string[] = []) => {
		if (!state.installed) throw new Error("Command failed to start: git (ENOENT)");
		if (args[0] === "--version") return { exitCode: 0, stdout: "git version 2.43.0\n", stderr: "" };
		return { exitCode: 128, stdout: "", stderr: "fatal: not a git repository" };
	});
	setGitCommand({ run });
	return state;
}

describe("Git panel without git", () => {
	it("guides the user to install git instead of offering to init a repository, and rechecks on demand", async () => {
		const state = host();
		render(<GitPanel />);

		expect(await screen.findByText("noGit.title")).toBeTruthy();
		expect(screen.getByText("noGit.subtitle")).toBeTruthy();
		expect(screen.queryByText("init.cta")).toBeNull();

		state.installed = true;
		screen.getByRole("button", { name: "noGit.recheck" }).click();

		expect(await screen.findByText("init.title")).toBeTruthy();
		expect(screen.queryByText("noGit.title")).toBeNull();
	});
});

describe("Git settings page without git", () => {
	it("shows the install hint above the settings and clears it after git is installed", async () => {
		const state = host();
		setAiApi({ listModels: async () => ({ models: [] }) } as never);
		setStorageApi({ get: async () => null, set: async () => undefined } as never);
		render(<GitSettingsView />);

		expect(await screen.findByText("noGit.settingsHint")).toBeTruthy();

		state.installed = true;
		screen.getByRole("button", { name: "noGit.recheck" }).click();

		await vi.waitFor(() => expect(screen.queryByText("noGit.settingsHint")).toBeNull());
		expect(screen.getByText("settings.title")).toBeTruthy();
	});
});
