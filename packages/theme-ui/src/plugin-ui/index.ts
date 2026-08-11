/**
 * 开放给**插件**的宿主 UI 组件（`@vetta/theme-ui/plugin-ui`）。
 *
 * 这里是一份**有意收窄**的清单，不是 theme-ui 的全部：插件通过 Module Federation
 * 共享域拿到宿主的同一份运行时实例，因此列进来的东西就成了宿主与插件之间的公共
 * UI 合同——props 变更会同时影响外置插件，加东西前先确认它值得被这样长期维护。
 *
 * 全部是纯展示组件：数据、文案、写回逻辑都由调用方经 props 提供，插件因此可以在
 * 自己的语义下复用宿主的形态（例如看板给「某张卡片」选模型，而宿主输入栏给
 * 「当前会话」选模型，用的是同一个选择器）。
 */

// 主题槽位注册表的类型增强（ThemeSurfaceRegistry）。不带上它，插件那侧的 TS program
// 里注册表是空的，组件内 `<ThemeSurface slot="chat.modelSelectorMenu" />` 会被判成 never。
import "../registry";

export type {
	ModelSelectorLabels,
	ModelSelectorOptionView,
	ModelSelectorProviderGroup,
	ModelSelectorViewProps,
} from "../chat/ModelSelectorView";
export { ModelSelectorView } from "../chat/ModelSelectorView";
export type { MultiplierTagProps } from "../shared/MultiplierTag";
export { fmtMultiplier, MultiplierTag } from "../shared/MultiplierTag";
export { getProviderIcon, PROVIDER_ICONS, ProviderIcon } from "../shared/provider-icon";
