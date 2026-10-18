// @vitest-environment jsdom
import type { OnboardingBridge } from "@shared/onboarding-ipc";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./i18n", () => ({ subscribeOnboardingLanguage: () => () => {} }));

const { OnboardingApp } = await import("./OnboardingApp.js");

type Permissions = { accessibility: boolean; screenRecording: boolean };

function createBridge(initial: Permissions, requested: Permissions): OnboardingBridge {
	return {
		initialLanguage: "zh",
		checkPermissions: vi.fn(async () => initial),
		requestPermissions: vi.fn(async () => requested),
		openPane: vi.fn(async () => {}),
		startDrag: vi.fn(),
		close: vi.fn(async () => {}),
		onPermissionsUpdated: vi.fn(() => () => {}),
		onDragError: vi.fn(() => () => {}),
		onLanguageChanged: vi.fn(() => () => {}),
	} as unknown as OnboardingBridge;
}

describe("authorization guide", () => {
	beforeEach(() => {
		vi.stubGlobal("astraviaOnboarding", undefined);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("denied permissions expose a request action wired to the helper prompts", async () => {
		const bridge = createBridge(
			{ accessibility: false, screenRecording: false },
			{ accessibility: true, screenRecording: true },
		);
		window.astraviaOnboarding = bridge;

		const { container } = render(<OnboardingApp />);
		await waitFor(() => expect(bridge.checkPermissions).toHaveBeenCalledTimes(1));

		const requestButton = screen.getByText("onboardingRequest");
		expect(screen.queryByText("onboardingAllGranted")).toBeNull();

		fireEvent.click(requestButton);

		await waitFor(() => expect(bridge.requestPermissions).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(screen.queryByText("onboardingAllGranted")).not.toBeNull());

		// 双授权后按钮与拖拽提示都不再需要占位，只留完成态。
		expect(screen.queryByText("onboardingRequest")).toBeNull();
		expect(container.textContent).not.toContain("onboardingDragError");
	});

	it("granted permissions skip the request action entirely", async () => {
		const bridge = createBridge(
			{ accessibility: true, screenRecording: true },
			{ accessibility: true, screenRecording: true },
		);
		window.astraviaOnboarding = bridge;

		render(<OnboardingApp />);

		await waitFor(() => expect(screen.queryByText("onboardingAllGranted")).not.toBeNull());
		expect(screen.queryByText("onboardingRequest")).toBeNull();
		expect(bridge.requestPermissions).not.toHaveBeenCalled();
	});
});
