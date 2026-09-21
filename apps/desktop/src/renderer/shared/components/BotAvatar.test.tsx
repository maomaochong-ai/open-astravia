// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BotAvatar } from "./BotAvatar";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
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
