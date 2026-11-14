export interface DesktopUiZoomApi {
	/** 当前主窗口界面缩放比例（1 = 100%）。 */
	get(): Promise<number>;
	/** 设置比例；主进程会夹取到允许档位，返回实际生效的值。 */
	set(factor: number): Promise<number>;
	/** 在当前档位上走一档。preload 不暴露任意步长，快捷键与菜单共用这里。 */
	step(direction: 1 | -1): Promise<number>;
	/** 回到默认档。 */
	reset(): Promise<number>;
	/** 上报页头图标的实测中线（CSS px），主进程据此摆放 macOS 红绿灯。 */
	reportTitlebarCenter(centerCssPx: number): void;
	/** 订阅比例变化（含快捷键触发的）。返回取消订阅函数。 */
	onChanged(handler: (factor: number) => void): () => void;
}
