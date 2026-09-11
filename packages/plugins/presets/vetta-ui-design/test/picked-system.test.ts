import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { DesignSystem } from "../src/design-systems/types";

const installSystemResources = vi.fn(async () => undefined);
vi.mock("../src/gallery/start-from-system", () => ({ installSystemResources }));

type ConversationListener = (event: {
	type: string;
	conversation?: { cwd: string | null } | null;
}) => void;

// 待落盘的选择是模块级单例（一次插件激活就一份），用例之间必须换一份新的模块实例，
// 否则上一条用例残留的 cwd 会让下一条看起来「早就知道该往哪落」。
let rememberPickedSystem: (system: DesignSystem) => void;

async function mountWatcher(): Promise<ConversationListener> {
	vi.resetModules();
	const module = await import("../src/new-session/picked-system");
	rememberPickedSystem = module.rememberPickedSystem;
	let listener: ConversationListener = () => undefined;
	module.watchPickedSystem({
		conversation: {
			on: (handler: ConversationListener) => {
				listener = handler;
				return { dispose: () => undefined };
			},
		},
	} as unknown as PluginContext);
	return (event) => listener(event);
}

const SYSTEM = { id: "brutalist", name: "Brutalist" } as unknown as DesignSystem;

beforeEach(() => {
	installSystemResources.mockClear();
});

describe("picked design system", () => {
	it("waits for the send: knowing the cwd is not enough", async () => {
		const emit = await mountWatcher();
		emit({ type: "conversation-changed", conversation: { cwd: "/w/project" } });
		rememberPickedSystem(SYSTEM);

		// 挑挑拣拣是常态，没发就落盘会在项目里留下一堆没用上的参考资料。
		expect(installSystemResources).not.toHaveBeenCalled();
	});

	it("installs once both the send and the cwd are known", async () => {
		const emit = await mountWatcher();
		emit({ type: "conversation-changed", conversation: { cwd: "/w/project" } });
		rememberPickedSystem(SYSTEM);
		emit({ type: "turn-start" });

		expect(installSystemResources).toHaveBeenCalledWith(SYSTEM, "/w/project");
	});

	it("still installs when the workspace only appears after the send", async () => {
		const emit = await mountWatcher();
		rememberPickedSystem(SYSTEM);
		// 团队会话就是这个次序：先发送，再建会话，工作目录最后才出现。按「turn-start 时
		// 读 cwd」写的话，团队的第一轮永远落不了盘。
		emit({ type: "turn-start" });
		expect(installSystemResources).not.toHaveBeenCalled();

		emit({ type: "conversation-changed", conversation: { cwd: "/w/team" } });
		expect(installSystemResources).toHaveBeenCalledWith(SYSTEM, "/w/team");
	});

	it("does not carry a pending style into the next turn", async () => {
		const emit = await mountWatcher();
		emit({ type: "conversation-changed", conversation: { cwd: "/w/project" } });
		rememberPickedSystem(SYSTEM);
		emit({ type: "turn-start" });
		emit({ type: "turn-start" });

		expect(installSystemResources).toHaveBeenCalledTimes(1);
	});

	it("re-arms when the user swaps the style before sending", async () => {
		const emit = await mountWatcher();
		emit({ type: "conversation-changed", conversation: { cwd: "/w/project" } });
		rememberPickedSystem(SYSTEM);
		emit({ type: "turn-start" });
		installSystemResources.mockClear();

		// 换一套风格是新的一次选择：上一轮的发送不该把它顺手带下去。
		const other = { id: "swiss", name: "Swiss" } as unknown as DesignSystem;
		rememberPickedSystem(other);
		expect(installSystemResources).not.toHaveBeenCalled();

		emit({ type: "turn-start" });
		expect(installSystemResources).toHaveBeenCalledWith(other, "/w/project");
	});
});
