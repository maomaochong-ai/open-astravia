// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rendererCapabilityHost } from "../../capabilities/renderer-capability-host";
import { registerHostedRouteCapabilityProvider } from "../../hosted-routes/hosted-route-capability-provider";
import { HostedRouteService } from "../../hosted-routes/hosted-route-service";
import { useThemeRuntime } from "./ThemeRuntimeContext";
import { ThemeRuntimeProvider } from "./ThemeRuntimeProvider";

const federation = vi.hoisted(() => ({
	createInstance: vi.fn(),
	loadRemote: vi.fn(),
}));
vi.mock("@module-federation/enhanced/runtime", () => ({ createInstance: federation.createInstance }));

function ThemeControls(): JSX.Element {
	const theme = useThemeRuntime();
	return (
		<>
			<output>
				{theme.activeThemeId}:{theme.status}
			</output>
			<button onClick={() => void theme.selectTheme("test-theme")}>Select theme</button>
			<button onClick={() => void theme.selectTheme("default")}>Use default</button>
		</>
	);
}

let disposeProvider = () => {};
beforeEach(() => {
	disposeProvider = registerHostedRouteCapabilityProvider(rendererCapabilityHost, new HostedRouteService()).dispose;
});

afterEach(() => {
	cleanup();
	disposeProvider();
	localStorage.clear();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("theme startup", () => {
	it("shows default content without the remote runtime, then switches to a remote theme and back", async () => {
		const themePackage = {
			id: "test-theme",
			source: "builtin",
			version: "1",
			sdkVersion: "1",
			displayName: "Test",
			entryUrl: "https://theme.invalid/remoteEntry.js",
			styleUrls: [],
			moduleFederation: { remoteName: "test_theme", expose: "./theme" },
		};
		federation.createInstance.mockReturnValue({ registerRemotes: vi.fn(), loadRemote: federation.loadRemote });
		federation.loadRemote.mockResolvedValue({ default: { meta: { id: "test-theme", name: "Test", version: "1" } } });
		vi.stubGlobal("vetta", { themes: { list: vi.fn().mockResolvedValue([themePackage]) } });
		render(
			<ThemeRuntimeProvider>
				<ThemeControls />
			</ThemeRuntimeProvider>,
		);
		await screen.findByText("default:ready");
		expect(federation.createInstance).not.toHaveBeenCalled();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Select theme" }));
			await vi.dynamicImportSettled();
		});
		await screen.findByText("test-theme:ready");
		expect(federation.loadRemote).toHaveBeenCalledWith("test_theme/theme", { from: "runtime" });
		await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use default" })));
		await screen.findByText("default:ready");
		expect(localStorage.getItem("vetta-ui-theme")).toBe("default");
	}, 30_000);

	it("recovers a missing saved theme without importing a remote runtime", async () => {
		localStorage.setItem("vetta-ui-theme", "missing");
		vi.stubGlobal("vetta", { themes: { list: vi.fn().mockResolvedValue([]) } });
		render(
			<ThemeRuntimeProvider>
				<ThemeControls />
			</ThemeRuntimeProvider>,
		);
		await waitFor(() => expect(screen.getByText("default:error")).toBeTruthy());
		expect(federation.createInstance).not.toHaveBeenCalled();
		expect(localStorage.getItem("vetta-ui-theme")).toBe("default");
	});
});
