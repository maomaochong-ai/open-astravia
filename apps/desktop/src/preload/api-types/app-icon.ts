import type { AppIconId } from "../../shared/app-icon.js";

export interface DesktopAppIconApi {
	/** 当前生效的图标 id；未知或缺失时是出厂图标。 */
	get(): Promise<AppIconId>;
	/** 设置图标；主进程立即套用并落盘，返回实际生效的 id。 */
	set(id: AppIconId): Promise<AppIconId>;
	/** 订阅图标变化（含其他窗口触发的）。返回取消订阅函数。 */
	onChanged(handler: (id: AppIconId) => void): () => void;
}
