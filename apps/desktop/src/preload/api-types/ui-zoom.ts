export interface DesktopUiZoomApi {
	/** 当前主窗口界面缩放比例（1 = 100%）。 */
	get(): Promise<number>;
	/** 设置比例；主进程会夹取到允许档位，返回实际生效的值。 */
	set(factor: number): Promise<number>;
	/** 渲染进程当前实际生效的页面缩放（取自 webFrame，不经主进程）。 */
	getActualZoom(): number;
	/** 直接把页面缩放写到渲染进程；只用来纠正与档位不一致的实际缩放，档位本身仍由 set 修改。 */
	applyZoom(factor: number): void;
	/** 在当前档位上走一档。preload 不暴露任意步长，快捷键与菜单共用这里。 */
	step(direction: 1 | -1): Promise<number>;
	/** 回到默认档。 */
	reset(): Promise<number>;
	/** 上报页头图标的实测中线（CSS px），主进程据此摆放 macOS 红绿灯。 */
	reportTitlebarCenter(centerCssPx: number): void;
	/** 订阅比例变化（含快捷键触发的）。返回取消订阅函数。 */
	onChanged(handler: (factor: number) => void): () => void;
	/** 订阅快捷键（Cmd/Ctrl +/-/0）触发的缩放，参数是生效后的比例；滑块拖动不会触发。 */
	onShortcutZoom(handler: (factor: number) => void): () => void;
}
