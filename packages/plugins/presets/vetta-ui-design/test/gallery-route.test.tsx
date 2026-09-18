// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 切页薄壳合同：
 * - startTransition 里第一次提交只有同步 Hero 标题，不能等 GalleryView chunk；
 * - import 一解析完就挂 GalleryView，不再空等两帧 rAF；
 * - Hero 在屏期间就开始预取 DesignSystemGrid。
 */

const galleryViewRender = vi.hoisted(() => vi.fn());
const galleryViewGate = vi.hoisted(() => {
	let resolveReady: () => void = () => undefined;
	let ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	return {
		release() {
			resolveReady();
		},
		wait() {
			return ready;
		},
	};
});
const gridChunk = vi.hoisted(() => ({ loaded: false }));

vi.mock("@vetta-org/plugin-sdk", () => {
	const t = (key: string) => key;
	return { useTranslation: () => ({ t, locale: "zh" }) };
});

vi.mock("../src/gallery/GalleryView", async () => {
	await galleryViewGate.wait();
	return {
		GalleryView: () => {
			galleryViewRender();
			return <p>gallery-body</p>;
		},
	};
});

vi.mock("../src/gallery/DesignSystemGrid", () => {
	gridChunk.loaded = true;
	return { DesignSystemGrid: () => <p>style-grid-chunk</p> };
});

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { GalleryRoute } = await import("../src/gallery/GalleryRoute");
const { GalleryHeroShell } = await import("../src/gallery/GalleryHeroShell");

describe("GalleryRoute 切页薄壳", () => {
	let host: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		galleryViewRender.mockClear();
		vi.stubGlobal("requestAnimationFrame", () => 1);
		vi.stubGlobal("cancelAnimationFrame", () => undefined);
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	});

	afterEach(() => {
		act(() => root.unmount());
		host.remove();
		vi.unstubAllGlobals();
	});

	it("Given 用户点侧栏设计, When GalleryRoute 首次提交, Then 只有 Hero 标题；import 回来后挂 GalleryView，且不等两帧 rAF", async () => {
		await act(async () => {
			root.render(<GalleryRoute />);
		});
		expect(host.textContent).toContain("gallery.hero.title");
		expect(host.textContent).not.toContain("gallery-body");
		expect(galleryViewRender).not.toHaveBeenCalled();
		expect(gridChunk.loaded).toBe(true);

		await act(async () => {
			galleryViewGate.release();
			await galleryViewGate.wait();
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(galleryViewRender).toHaveBeenCalled();
		expect(host.textContent).toContain("gallery-body");
	});

	it("薄壳本身就能画出标题", async () => {
		await act(async () => {
			root.render(<GalleryHeroShell />);
		});
		expect(host.textContent).toContain("gallery.hero.title");
		expect(host.textContent).not.toContain("gallery-body");
	});
});
