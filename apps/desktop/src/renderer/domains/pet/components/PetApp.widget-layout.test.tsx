// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PetApp } from "./PetApp";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

class FakeResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

describe("PetApp widget layout", () => {
	beforeEach(() => {
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("shrink-wraps to the sprite instead of covering the desktop", () => {
		const { container } = render(<PetApp />);
		const root = container.firstElementChild as HTMLElement | null;
		expect(root?.className).toContain("inline-flex");
		expect(root?.className).toContain("flex-col");
		expect(root?.className).not.toContain("fixed");
		expect(root?.className).not.toContain("inset-0");
	});
});
