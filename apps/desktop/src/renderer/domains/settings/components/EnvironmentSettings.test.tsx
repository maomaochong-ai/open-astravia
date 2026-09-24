// @vitest-environment jsdom
/**
 * 设置 → 环境 → 开发工具 → Git：没装 Git 时按平台给出安装引导，装好或重新检测后显示版本。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../ai-assist", () => ({ SettingsAiAssist: () => null }));
vi.mock("./recordSettingsUsage", () => ({ recordSettingsUsage: vi.fn() }));

const { EnvironmentSettings } = await import("./EnvironmentSettings");
const { GIT_DOWNLOAD_URL } = await import("./useEnvironmentSettingsModel");

type GitStatus = {
	available: boolean;
	source?: "managed" | "system";
	version?: string;
	install:
		| { kind: "xcode-clt" }
		| { kind: "managed-download"; version: string }
		| { kind: "package-manager"; command: string | null }
		| { kind: "manual" };
};

const runtime = { ready: true, supported: true, recommendedVersion: "1", managedVersion: "1", activeSource: "managed" };

function statusWith(git: GitStatus) {
	return {
		node: { ...runtime, type: "node" },
		python: { ...runtime, type: "python" },
		git,
		mirrors: { npmRegistry: "npm", pipIndexUrl: "pip" },
	};
}

function mockVetta(git: GitStatus) {
	const api = {
		runtimes: {
			getStatus: vi.fn(async () => statusWith(git)),
			reinstall: vi.fn(),
			redetect: vi.fn(async () => statusWith(git)),
			installGit: vi.fn(async () => git),
		},
		shell: { openExternal: vi.fn(async () => undefined) },
	};
	(window as unknown as { vetta: unknown }).vetta = api;
	return api;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("EnvironmentSettings · Git", () => {
	it("macOS: opens the system installer, then shows the version after checking again", async () => {
		const user = userEvent.setup();
		const api = mockVetta({ available: false, install: { kind: "xcode-clt" } });
		render(<EnvironmentSettings />);

		expect(await screen.findByText("environmentGit.missing")).toBeTruthy();
		expect(screen.getByText("environmentGit.xcodeHint")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "environmentGit.installXcode" }));
		expect(api.runtimes.installGit).toHaveBeenCalledOnce();
		expect(await screen.findByText("environmentGit.xcodeLaunched")).toBeTruthy();

		api.runtimes.redetect.mockResolvedValueOnce(
			statusWith({ available: true, source: "system", version: "2.39.5", install: { kind: "xcode-clt" } }),
		);
		await user.click(screen.getByRole("button", { name: "environmentGit.redetect" }));

		expect(await screen.findByText("ready · 2.39.5")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "environmentGit.installXcode" })).toBeNull();
	});

	it("Windows: installs MinGit for Vetta and marks it as Vetta-only", async () => {
		const user = userEvent.setup();
		const api = mockVetta({ available: false, install: { kind: "managed-download", version: "2.55.0.5" } });
		let finish: (value: GitStatus) => void = () => undefined;
		api.runtimes.installGit.mockImplementationOnce(
			() =>
				new Promise<GitStatus>((resolve) => {
					finish = resolve;
				}),
		);
		render(<EnvironmentSettings />);

		await user.click(await screen.findByRole("button", { name: "environmentGit.installManaged" }));
		expect(screen.getByText("environmentGit.installing")).toBeTruthy();
		expect(screen.getByRole("button", { name: /environmentGit.installManaged/ }).hasAttribute("disabled")).toBe(true);

		finish({
			available: true,
			source: "managed",
			version: "2.55.0.5",
			install: { kind: "managed-download", version: "2.55.0.5" },
		});
		expect(await screen.findByText("ready · 2.55.0.5 · environmentGit.managedSuffix")).toBeTruthy();
	});

	it("Windows: links to the official installer for a system-wide Git", async () => {
		const user = userEvent.setup();
		const api = mockVetta({ available: false, install: { kind: "managed-download", version: "2.55.0.5" } });
		render(<EnvironmentSettings />);

		await user.click(await screen.findByRole("button", { name: "environmentGit.download" }));
		expect(api.shell.openExternal).toHaveBeenCalledWith(GIT_DOWNLOAD_URL);
	});

	it("Linux: shows the package manager command and copies it", async () => {
		const user = userEvent.setup();
		const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
		mockVetta({ available: false, install: { kind: "package-manager", command: "sudo apt install git" } });
		render(<EnvironmentSettings />);

		expect(await screen.findByText("sudo apt install git")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "environmentGit.installXcode" })).toBeNull();

		await user.click(screen.getByRole("button", { name: "environmentGit.copy" }));
		expect(writeText).toHaveBeenCalledWith("sudo apt install git");
		expect(await screen.findByRole("button", { name: "environmentGit.copied" })).toBeTruthy();
	});

	it("surfaces a failed install instead of swallowing it", async () => {
		const user = userEvent.setup();
		const api = mockVetta({ available: false, install: { kind: "managed-download", version: "2.55.0.5" } });
		api.runtimes.installGit.mockRejectedValueOnce(new Error("HTTP 404"));
		render(<EnvironmentSettings />);

		await user.click(await screen.findByRole("button", { name: "environmentGit.installManaged" }));
		await waitFor(() => expect(screen.getByText("HTTP 404")).toBeTruthy());
		expect(screen.getByText("environmentGit.missing")).toBeTruthy();
	});
});
