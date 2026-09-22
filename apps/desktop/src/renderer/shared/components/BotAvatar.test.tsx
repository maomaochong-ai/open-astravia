// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BotAvatar } from "./BotAvatar";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it("流式中（active）不再自动做小动作：静态光晕表达进行中，避免 motion 逐帧出帧", () => {
	// 只伪造 setTimeout：motion 会缓存 requestAnimationFrame 的引用，伪造它会让后面的用例卡死。
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	// ACTIVE_MOODS 最后一项是 sleep，它会渲染出可观察的「z」。
	vi.spyOn(Math, "random").mockReturnValue(0.99);
	render(<BotAvatar active title="流式中" />);

	act(() => vi.advanceTimersByTime(10_000));
	expect(screen.queryByText("z")).toBeNull();
});

it("autoplay 的小动作之间至少空 1.4s", () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	// 随机间隔顶到上限（2984ms）。
	vi.spyOn(Math, "random").mockReturnValue(0.99);
	render(<BotAvatar autoplay title="欢迎页" />);

	act(() => vi.advanceTimersByTime(1399));
	expect(screen.queryByText("z")).toBeNull();
	act(() => vi.advanceTimersByTime(1600));
	expect(screen.queryByText("z")).toBeTruthy();
});

it("用户戳头像触发打瞌睡后，「z」会随姿态结束而消失，不留下常驻动画", async () => {
	// ACTIVE_MOODS 最后一项是 sleep
	vi.spyOn(Math, "random").mockReturnValue(0.99);
	render(<BotAvatar title="戳一下" />);

	fireEvent.click(screen.getByTitle("戳一下"));
	expect(await screen.findByText("z")).toBeTruthy();

	// sleep 姿态保持 1.5s 后回到 idle；「z」退场动画必须能结束并卸载，
	// 否则它会以无限循环一直驱动页面出帧。
	await waitFor(() => expect(screen.queryByText("z")).toBeNull(), { timeout: 4000 });
});
