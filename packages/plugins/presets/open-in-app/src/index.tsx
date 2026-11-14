import { definePlugin } from "@astravia-org/plugin-sdk";
import "./style.css";
import { releaseHostApis, setHostApis, useOpenInAppAction } from "./OpenInApp";

export default definePlugin({
	activate(ctx) {
		setHostApis(ctx.shell, ctx.ui.notify);
		ctx.ui.registerHeaderAction({
			id: "open-in-app",
			// 排最前：内置按钮组左边的第一格，之后别的插件按自己的 order 往左排。
			order: 100,
			useAction: useOpenInAppAction,
		});
		// 用本次激活的清理函数释放，而不是 deactivate()：宿主重试/热重载时新一次激活可能先于旧一次的清理，
		// 清理只认自己登记的那份接口，不会误抹新的。
		return () => releaseHostApis(ctx.shell);
	},
});
