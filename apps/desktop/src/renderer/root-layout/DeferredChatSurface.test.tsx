// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeferredChatSurface } from "./DeferredChatSurface";

async function flushAnimationFrame(): Promise<void> {
	await act(async () => {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	});
}

describe("DeferredChatSurface", () => {
	it("从未打开过聊天时不预挂载对话树", () => {
		const { container } = render(
			<DeferredChatSurface active={false}>
				<p>chat body</p>
			</DeferredChatSurface>,
		);
		expect(container.textContent).not.toContain("chat body");
	});

	it("切走后隐藏但仍保留同一棵对话树，切回不重建", async () => {
		const { container, rerender } = render(
			<DeferredChatSurface active>
				<p>chat body</p>
			</DeferredChatSurface>,
		);
		const first = container.querySelector("p");
		expect(first?.textContent).toBe("chat body");

		rerender(
			<DeferredChatSurface active={false}>
				<p>chat body</p>
			</DeferredChatSurface>,
		);
		const leaving = container.querySelector("p");
		expect(leaving).toBe(first);
		expect(leaving?.closest("[hidden]")).toBeNull();
		expect(leaving?.closest("div")?.className).not.toContain("flex-1");

		await flushAnimationFrame();
		expect(container.querySelector("p")).toBe(first);
		expect(container.querySelector("p")?.closest("[hidden]")).not.toBeNull();

		rerender(
			<DeferredChatSurface active>
				<p>chat body</p>
			</DeferredChatSurface>,
		);
		expect(container.querySelector("p")).toBe(first);
		expect(container.querySelector("[hidden]")).toBeNull();
	});
});
