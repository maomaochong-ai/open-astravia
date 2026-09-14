import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

const readDir = vi.fn();
vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({ fs: { readDir }, ui: { previewImage: vi.fn() } }),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ScreenshotCard } from "../src/cards/ScreenshotCard";
import { SCREENSHOT_CARD_TYPE } from "../src/cards/screenshot-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let frameSeq = 0;

beforeEach(() => {
	readDir.mockReset();
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

/** 每个用例用独立 frameId，避开模块级 snapshotCache 的跨用例污染。 */
function makeProps(pending: boolean) {
	return {
		descriptor: {
			type: SCREENSHOT_CARD_TYPE,
			key: `d.vetd#frame${frameSeq}`,
			payload: { dirPath: "/w/d.vetd", frameId: `frame${frameSeq}` },
		},
		pending,
	} as never;
}

function entry(name: string) {
	return { name, path: `/w/d.vetd/.snapshots/${name}`, isDirectory: false };
}

/** 让所有已排队的 promise 回调跑完。 */
async function flush(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

describe("ScreenshotCard 高度稳定性", () => {
	it("重扫在途时不塌陷：pending 落定到扫描返回之间，卡片区必须保持占位", async () => {
		frameSeq++;
		// 第一次扫描：截图还没落盘，目录不存在
		readDir.mockRejectedValueOnce(new Error("ENOENT"));
		await act(async () => {
			root.render(<ScreenshotCard {...makeProps(true)} />);
		});
		await flush();
		expect(host.innerHTML, "pending 期间应有骨架占位").not.toBe("");

		// 工具落定：pending 转 false，重扫这一刻还没返回
		readDir.mockImplementationOnce(() => new Promise(() => {}));
		await act(async () => {
			root.render(<ScreenshotCard {...makeProps(false)} />);
		});

		expect(
			host.innerHTML,
			"重扫在途时卡片区塌成 0，会把整条消息列表顶得上下弹跳",
		).not.toBe("");
	});

	it("扫描确实为空且不在途时才隐藏卡片", async () => {
		frameSeq++;
		readDir.mockResolvedValueOnce([]);
		await act(async () => {
			root.render(<ScreenshotCard {...makeProps(false)} />);
		});
		await flush();
		expect(host.innerHTML).toBe("");
	});

	it("已有截图后，一次落空的重扫不得清掉已展示的内容", async () => {
		frameSeq++;
		readDir.mockResolvedValueOnce([entry(`frame${frameSeq}-1.png`)]);
		await act(async () => {
			root.render(<ScreenshotCard {...makeProps(false)} />);
		});
		await flush();
		expect(host.querySelectorAll("img")).toHaveLength(1);

		// 新一轮开始，重扫因为瞬时读失败返回空
		readDir.mockResolvedValueOnce([]);
		await act(async () => {
			root.render(<ScreenshotCard {...makeProps(true)} />);
		});
		await flush();
		expect(host.querySelectorAll("img"), "落空的重扫不该抹掉已有版本").toHaveLength(1);
	});
});
