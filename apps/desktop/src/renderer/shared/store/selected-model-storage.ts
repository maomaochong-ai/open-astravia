/**
 * 新会话的全局模型偏好（localStorage）。
 *
 * 单独成模块而不是留在 `chat-atoms`：需要「这个键名」的地方（设置页模型表单、
 * 初始化、输入栏）不应该为了一个字符串去构造整个 jotai store —— 那会把
 * localStorage 的模块级读取一并带进纯 Node 环境（单元测试、无 DOM 渲染），
 * 让一个只读常量的 import 变成加载失败。
 */

export const SELECTED_MODEL_STORAGE_KEY = "astravia-selected-model";

/** localStorage 只在 renderer 存在；拿不到就当作「没有偏好」。 */
function storage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

export function readSelectedModel(): string | null {
	const store = storage();
	if (!store) return null;
	try {
		return store.getItem(SELECTED_MODEL_STORAGE_KEY);
	} catch {
		return null;
	}
}

/** 写回偏好；`null` / `undefined` 都表示清空（回到「未设置」）。 */
export function writeSelectedModel(key: string | null | undefined): void {
	const store = storage();
	if (!store) return;
	try {
		if (key === null || key === undefined) store.removeItem(SELECTED_MODEL_STORAGE_KEY);
		else store.setItem(SELECTED_MODEL_STORAGE_KEY, key);
	} catch {
		// 隐私模式 / 配额耗尽：偏好不是关键路径，失败就当没记住。
	}
}
