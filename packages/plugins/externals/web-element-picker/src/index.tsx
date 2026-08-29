import { definePlugin } from "@astravia-org/plugin-sdk";
import { WebElementPickerPanel } from "./WebElementPickerPanel";
import { pushPickerIntent, setPluginCtx } from "./plugin-context";
import "./style.css";

// 地球图标（活动 Tab 与输入栏 action 共用）。注意：MF 插件共享依赖异步填充，
// 模块顶层不能求值 JSX，用函数惰性构造，activate 内调用。
// 返回类型不显式标注：插件 tsc 环境无 JSX 命名空间，交给推断。
const earthIcon = () => (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
		<circle cx="12" cy="12" r="9" />
		<path d="M3.5 12h17M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z" strokeLinecap="round" />
	</svg>
);

export default definePlugin({
	activate(ctx) {
		setPluginCtx(ctx);
		// 注意：MF 插件的共享依赖（含 jsx runtime）是异步填充的，模块顶层
		// 不能出现 JSX；icon 须在 activate 内构造（此时 bootstrap 已完成）。
		ctx.ui.registerActivityTab({
			id: "web-element-picker",
			label: "%tab.label%",
			icon: earthIcon(),
			component: WebElementPickerPanel,
			scope_use: ["conversation", "project", "cli"],
			initiallyVisible: true,
		});
		// 输入栏入口：一键从输入栏直达选择流程（点亮 → 上栏并展开网页选择器 Tab，
		// 页面就绪后自动进入选择模式；再点熄灭 → 停止选择）。配合 decoratePrompt，
		// 点亮期间 AI 会收到「用户在网页上选取元素」的上下文提示。
		ctx.ui.registerInputAction({
			id: "element-picker",
			label: "%action.elementPicker.label%",
			icon: earthIcon(),
			scope_use: ["conversation", "project", "cli"],
			onToggle: (active) => {
				if (active) {
					pushPickerIntent("start-select");
					ctx.ui.setActivityTabVisible("web-element-picker", true);
					ctx.ui.openActivityTab("web-element-picker", { width: "max" });
				} else {
					pushPickerIntent("stop-select");
				}
			},
			decoratePrompt: () => ({
				instructions: [
					"The user is working with the Web Element Picker. Element context selected on a web page may have been sent to this conversation; use it to make the requested code changes.",
				],
			}),
		});
	},
});
