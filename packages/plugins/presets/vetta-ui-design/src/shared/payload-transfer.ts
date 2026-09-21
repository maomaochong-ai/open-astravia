import type { PluginContext } from "@vetta-org/plugin-sdk";
import { routeOf } from "../history/machine";

/**
 * 把一大块内容写到目标机器上的一个文件里，分块传输。
 *
 * 插件只能通过 `command.run` 往目标机器送数据，而命令行参数与环境变量都有硬上限：
 * Linux 上单个字符串最多 128 KB（`MAX_ARG_STRLEN`），超了直接 E2BIG；远程项目还要多过一层
 * shell 命令串，限制一样。引擎模板与历史 runner 都是几百 KB 的量级，只能切开送。
 *
 * macOS 没有这个单参数限制，所以一次性塞进环境变量在 mac 上「一直是好的」——这条路在
 * Linux 桌面端和所有远程项目上都是坏的，只是没人碰到过。
 *
 * 每块都重发一遍目标路径而不是维持一个「会话」：命令之间没有共享状态，第一块负责清掉上次
 * 中断留下的残余。
 */
const CHUNK_CHARS = 16_000;

const APPEND_SCRIPT = [
	"const fs=require('fs'),p=require('path');",
	"const target=process.env.VETD_PAYLOAD_TARGET;",
	"if(!target)throw new Error('VETD_PAYLOAD_TARGET missing');",
	"fs.mkdirSync(p.dirname(target),{recursive:true});",
	"if(process.env.VETD_PAYLOAD_FIRST==='1'&&fs.existsSync(target))fs.rmSync(target);",
	"fs.appendFileSync(target,Buffer.from(process.env.VETD_PAYLOAD_CHUNK??'','base64'));",
	"process.stdout.write('ok');",
].join("");

export interface TransferPayloadOptions {
	/** 决定发到哪台机器，以及命令的工作目录——必须是一个已经存在的目录。 */
	readonly route: string;
	/** 目标机器上的绝对路径。中间目录会被创建。 */
	readonly target: string;
	/** base64 编码后的内容。 */
	readonly payload: string;
	readonly label: string;
}

export async function transferPayload(ctx: PluginContext, options: TransferPayloadOptions): Promise<void> {
	const { payload } = options;
	for (let offset = 0, index = 0; offset < payload.length; offset += CHUNK_CHARS, index++) {
		const result = await ctx.command.run("node", ["-e", APPEND_SCRIPT], {
			cwd: routeOf(options.route),
			env: {
				VETD_PAYLOAD_TARGET: options.target,
				VETD_PAYLOAD_CHUNK: payload.slice(offset, offset + CHUNK_CHARS),
				VETD_PAYLOAD_FIRST: index === 0 ? "1" : "0",
			},
			timeoutMs: 30_000,
		});
		if (result.exitCode !== 0) {
			throw new Error(`${options.label} write failed: ${result.stderr || result.stdout}`);
		}
	}
}

/** 文本 → base64，供 {@link transferPayload} 使用。 */
export function base64FromText(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
