/**
 * 模板选择卡的发送接线（ADR-0060）：点击即 sendPrompt、一次性锁防重发、
 * streaming 中排队的真实反馈（「已排队」→ 消费后「已选择」）、失败解锁重试、
 * 以及虚拟滚动重挂载后锁不复位。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string, _opts?: unknown) => key }),
}));

type QueueListener = (event: {
	type: string;
	queue?: { paused: boolean; items: Array<{ id: string; displayText: string }> };
}) => void;

const sendPrompt = vi.fn<() => Promise<{ status: "sent" | "queued"; queueItemId?: string }>>(async () => ({
	status: "sent" as const,
}));
const listeners = new Set<QueueListener>();
const notify = vi.fn();

vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({
		i18n: { locale: "zh-CN" },
		conversation: {
			sendPrompt,
			on: (listener: QueueListener) => {
				listeners.add(listener);
				return { dispose: () => listeners.delete(listener) };
			},
		},
	}),
	notify: (...args: unknown[]) => notify(...args),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DesignSystemPickerCard } from "../src/cards/DesignSystemPickerCard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let cardKeySeq = 0;

beforeEach(() => {
	vi.clearAllMocks();
	listeners.clear();
	sendPrompt.mockImplementation(async () => ({ status: "sent" as const }));
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	cardKeySeq += 1;
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

function descriptor(key = `card-${cardKeySeq}`) {
	return { type: "vetd-design-system", key, payload: { systems: ["linear", "stripe"], allowSkip: true } };
}

function render(d = descriptor()): void {
	act(() => {
		root.render(<DesignSystemPickerCard descriptor={d} pending={false} message={{ id: "m", role: "assistant", text: "" }} />);
	});
}

function clickTile(name: string): void {
	const button = [...host.querySelectorAll("button")].find((el) => el.textContent?.includes(name));
	if (!button) throw new Error(`tile ${name} not found`);
	act(() => {
		button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	});
}

async function flush(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
	});
}

it("点击体系格发送一次选择 prompt，随后整卡锁住不可重复触发", async () => {
	render();
	clickTile("Linear");
	await flush();

	expect(sendPrompt).toHaveBeenCalledTimes(1);
	expect(String(sendPrompt.mock.calls[0]?.[0])).toContain("linear");

	clickTile("Stripe");
	await flush();
	expect(sendPrompt).toHaveBeenCalledTimes(1);
});

it("streaming 中排队：回执 queued 显示「已排队」，条目被消费后翻成「已选择」", async () => {
	sendPrompt.mockImplementation(async () => ({ status: "queued" as const, queueItemId: "q-1" }));
	render();
	clickTile("Linear");
	await flush();

	expect(host.textContent).toContain("ds.card.queued");

	// 队列消费：queue-changed 里条目消失。
	act(() => {
		for (const listener of listeners) {
			listener({ type: "queue-changed", queue: { paused: false, items: [] } });
		}
	});
	expect(host.textContent).toContain("ds.card.picked");
	expect(host.textContent).not.toContain("ds.card.queued");
});

it("发送失败：通知用户并解锁，可重新选择", async () => {
	sendPrompt.mockImplementationOnce(async () => {
		throw new Error("boom");
	});
	render();
	clickTile("Linear");
	await flush();

	expect(notify).toHaveBeenCalledTimes(1);
	// 解锁后可再次选择并成功发送。
	clickTile("Stripe");
	await flush();
	expect(sendPrompt).toHaveBeenCalledTimes(2);
});

it("重挂载（虚拟滚动）后锁不复位：同 key 的卡不会重复发送", async () => {
	const d = descriptor("stable-key");
	render(d);
	clickTile("Linear");
	await flush();
	expect(sendPrompt).toHaveBeenCalledTimes(1);

	act(() => root.unmount());
	root = createRoot(host);
	render(d);

	expect(host.textContent).toContain("ds.card.picked");
	clickTile("Stripe");
	await flush();
	expect(sendPrompt).toHaveBeenCalledTimes(1);
});

it("skip 格发送「不使用模板」的 prompt", async () => {
	render();
	clickTile("ds.card.skip");
	await flush();

	expect(sendPrompt).toHaveBeenCalledTimes(1);
	expect(String(sendPrompt.mock.calls[0]?.[0])).toContain("不使用设计体系模板");
});
