import { createContext, useContext } from "react";
import type { ExecutionModeSelectorViewProps } from "../execution-mode-selector/types";

/**
 * 模型菜单底栏的宿主插槽：输入栏把「权限模式」（沙箱 / 完全访问）选择器的**数据**挂在这里，
 * 由模型菜单在底栏右侧渲染——底栏的位置、是否显示文案、弹出方向都由菜单自己决定，
 * 输入栏只提供数据。
 *
 * 为什么传数据而不是现成节点：底栏是菜单里的一个窄区域（右侧一列、没有容器查询上下文），
 * 直接塞进来的选择器会按「窄容器」渲染成纯图标，弹层也会朝右溢出。交出数据，菜单才能按
 * 自己的几何把它摆对。
 *
 * 为什么用 context 而不是全局 atom：同一个页面里可能同时存在两个输入栏（会话页与团队对话），
 * 全局单值会让后挂载的一方顶掉先挂载的一方，先卸载的一方又把对方的控件清空。
 * context 跟着输入栏各自的子树走，天然互不干扰；插件复用的模型菜单不在任何输入栏里，
 * 读到的就是默认的 null，不会凭空多出一颗权限控件。
 */
export const ModelMenuFooterContext = createContext<ExecutionModeSelectorViewProps | null>(null);

export function useModelMenuFooter(): ExecutionModeSelectorViewProps | null {
	return useContext(ModelMenuFooterContext);
}
