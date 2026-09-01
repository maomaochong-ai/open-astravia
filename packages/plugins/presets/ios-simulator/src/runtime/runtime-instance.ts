import { getPluginCtx } from "../plugin-context.js";
import { detectPlatform } from "../tab-visibility.js";
import { SimulatorRuntimeController } from "./simulator-runtime.js";

/**
 * 全插件共用一个 controller：serve 进程是插件级资源，不该按面板实例复制
 * （同一 cwd 的多个会话会各起一个 serve）。
 *
 * 刻意做成**惰性创建**而不是「activate 里建、取不到就抛」：宿主重载插件时，
 * 上一个激活的 deactivate() 可能在新的 activate() 之后才跑完（它要等
 * handle.stop() 的 SIGTERM 宽限），届时它会把新建的实例置空，而活动 Tab 仍然
 * 注册着——面板一渲染就抛 "runtime controller is not ready"。惰性创建让任何
 * 顺序下都能自愈：被置空后下一次取用重新建一个。
 */
let controller: SimulatorRuntimeController | null = null;

export function getRuntimeController(): SimulatorRuntimeController {
	if (!controller) {
		controller = new SimulatorRuntimeController({
			command: getPluginCtx().command,
			platform: detectPlatform(navigator.userAgent),
		});
	}
	return controller;
}

export async function disposeRuntimeController(): Promise<void> {
	const current = controller;
	controller = null;
	if (current) await current.dispose();
}
