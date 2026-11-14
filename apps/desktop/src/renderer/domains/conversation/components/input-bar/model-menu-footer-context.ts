import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * 模型菜单底栏的宿主插槽：输入栏把「权限模式」（沙箱 / 完全访问）选择器挂在这里。
 *
 * 为什么用 context 而不是全局 atom：同一个页面里可能同时存在两个输入栏（会话页与团队对话），
 * 全局单值会让后挂载的一方顶掉先挂载的一方，先卸载的一方又把对方的控件清空。
 * context 跟着输入栏各自的子树走，天然互不干扰；插件复用的模型菜单不在任何输入栏里，
 * 读到的就是默认的 null，不会凭空多出一颗权限控件。
 */
export const ModelMenuFooterContext = createContext<ReactNode>(null);

export function useModelMenuFooter(): ReactNode {
	return useContext(ModelMenuFooterContext);
}
