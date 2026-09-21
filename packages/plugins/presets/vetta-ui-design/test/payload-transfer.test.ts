import type { PluginContext } from "@vetta-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import { materializeEngineForTest } from "../src/engine/engine-manager";

/** Windows 单个环境变量上限 32767 字符，是三大平台里最紧的；按它卡就到处都安全。 */
const TIGHTEST_ENV_LIMIT = 32_767;

function recordEnvValues(): { ctx: PluginContext; values: string[] } {
	const values: string[] = [];
	const ctx = {
		command: {
			run: async (_file: string, args: string[], options?: { env?: Record<string, string> }) => {
				for (const value of Object.values(options?.env ?? {})) values.push(value);
				// 引导脚本要读那个载荷文件，这里只关心传参大小，直接报成功。
				return { stdout: "ok", stderr: "", exitCode: 0 };
			},
		},
	} as unknown as PluginContext;
	return { ctx, values };
}

describe("引擎模板的传输", () => {
	it("不把整包模板塞进一个环境变量——Linux 上单个字符串超过 128 KB 直接 E2BIG", async () => {
		// 回归：模板 base64 后约 180 KB。macOS 没有这个单参数限制所以一直没暴露，
		// 而 Linux 桌面端与所有远程项目（还要多过一层 shell 命令串）都会失败。
		const { ctx, values } = recordEnvValues();

		await materializeEngineForTest(ctx, "/home/dev/.vetta/design-engine/9.9.9", "/home/dev/design.vetd");

		expect(values.length).toBeGreaterThan(1);
		const longest = Math.max(...values.map((value) => value.length));
		expect(longest).toBeLessThanOrEqual(TIGHTEST_ENV_LIMIT);
	});
});
