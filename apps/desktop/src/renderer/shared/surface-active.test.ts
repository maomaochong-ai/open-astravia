// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useInactiveFrozenValue } from "./surface-active";

describe("useInactiveFrozenValue", () => {
	it("前台跟随最新值，切到后台后保持离开前的身份", () => {
		const { result, rerender } = renderHook(
			({ active, value }: { active: boolean; value: string }) => useInactiveFrozenValue(active, value),
			{ initialProps: { active: true, value: "models" } },
		);
		expect(result.current).toBe("models");

		rerender({ active: true, value: "appearance" });
		expect(result.current).toBe("appearance");

		rerender({ active: false, value: "general" });
		expect(result.current).toBe("appearance");

		rerender({ active: true, value: "general" });
		expect(result.current).toBe("general");
	});
});
