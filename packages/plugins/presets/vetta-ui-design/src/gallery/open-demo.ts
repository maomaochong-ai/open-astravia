import type { DesignSystem } from "../design-systems/types";
import { getPluginCtx } from "../plugin-context";
import { designSystemDemoHtml } from "./DesignSystemDemo";

/**
 * 把一套体系的 HTML demo 交给系统默认浏览器。
 *
 * `ui.openExternal` 只放行 http/https，demo 又是随清单送达的内联文本，没有可直接
 * 打开的线上地址（raw/jsDelivr 都按 text/plain 回，浏览器只会显示源码）。所以走
 * 已有的 `command.run("node")` 通道：把 demo 写进系统临时目录，再用平台默认打开器
 * 拉起浏览器。HTML 经 env 传递，不进 argv，也不落在任何项目目录里。
 */

/** 落盘文件名只由 slug 组成；slug 在 remote-catalog 已收紧到 kebab-case，这里再兜一层。 */
export function demoTempFileName(systemId: string): string {
	const safe = systemId.replace(/[^a-z0-9-]/gi, "").slice(0, 64) || "demo";
	return `vetta-demo-${safe}.html`;
}

/**
 * 写临时文件并用平台打开器拉起默认浏览器。文件名与内容都从 env 取：
 * argv 里只有这段固定脚本，不含任何用户数据。
 */
export const OPEN_DEMO_SCRIPT = [
	'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");',
	"const html=process.env.VETD_DEMO_HTML,name=process.env.VETD_DEMO_FILE;",
	'if(!html||!name){console.error("missing demo payload");process.exit(2);}',
	"const file=path.join(os.tmpdir(),path.basename(name));",
	"fs.writeFileSync(file,html);",
	'const win=process.platform==="win32";',
	'const cmd=process.platform==="darwin"?"open":win?"cmd":"xdg-open";',
	'const args=win?["/c","start","",file]:[file];',
	'const child=cp.spawn(cmd,args,{detached:true,stdio:"ignore"});',
	"child.unref();",
].join("\n");

/** 没有 demo 的体系返回 false（按钮本不该出现）；执行失败抛错，由调用方 notify。 */
export async function openDemoInBrowser(system: DesignSystem): Promise<boolean> {
	const html = designSystemDemoHtml(system);
	if (html === null) return false;
	const result = await getPluginCtx().command.run("node", ["-e", OPEN_DEMO_SCRIPT], {
		env: { VETD_DEMO_HTML: html, VETD_DEMO_FILE: demoTempFileName(system.id) },
		timeoutMs: 10_000,
	});
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.trim() || `open demo exited with ${result.exitCode}`);
	}
	return true;
}
