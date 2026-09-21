import type { ParseKeys } from "i18next";
import type { ComponentType } from "react";

/**
 * 内置底部面板组件的声明。
 *
 * 名字存的是 `chat` 命名空间下的 i18n key 而不是已解析的文案：定义表本身是模块常量，
 * 解析要发生在渲染期（语言可切换）。key 用 i18next 的 `ParseKeys` 约束，写错由 tsc 拦下。
 */
export interface BottomPanelBuiltin {
	readonly id: string;
	readonly order?: number;
	/** iconify 类名。 */
	readonly icon: string;
	readonly labelKey: ParseKeys<"chat">;
	readonly maxInstances?: number;
	/** 本地会话下需要本机 PTY；缺预编译二进制时不出现在「+」菜单里。 */
	readonly requiresLocalPty?: boolean;
	readonly component: ComponentType;
}
