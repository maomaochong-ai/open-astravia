/** 外部应用的用途分类：菜单据此排序并挑图标。 */
export type PluginExternalApplicationKind = "editor" | "file-manager" | "terminal" | "other";

/**
 * 一个能接手项目目录的外部应用。
 *
 * 由宿主按当前平台探测（macOS 应用目录与 LaunchServices、Windows 注册表与安装目录、
 * Linux `.desktop`），插件只负责展示。`iconUrl` 是宿主解析好的 PNG data URL，
 * 取不到时为空，插件应退回按 `kind` 的通用图标。
 */
export interface PluginExternalApplication {
	/** 平台内的稳定标识（macOS 是 `.app` 路径，Windows 是 exe 路径，Linux 是 Exec 命令）。 */
	readonly id: string;
	/** 菜单里显示的名称，宿主已换成友好名。 */
	readonly name: string;
	readonly kind: PluginExternalApplicationKind;
	/** 应用自己的图标（PNG data URL）；拿不到时为 `undefined`。 */
	readonly iconUrl?: string;
	/** 系统对目录的默认处理程序（macOS 的访达等）。 */
	readonly isDefault: boolean;
}

/**
 * 把本机路径交给外部应用。需要 `shell.open-external-app` 权限。
 *
 * 宿主内部按平台实现：macOS `open`、Windows 直接启动 exe / `explorer.exe`、Linux 调用
 * `.desktop` 里的 Exec。插件不需要也不应该自己拼命令行——平台差异只存在于宿主一处。
 */
export interface PluginShellApi {
	/**
	 * 列出能打开该路径的外部应用（编辑器 → 文件管理器 → 终端）。
	 * `targetPath` 为 `null` 时只返回本机装了哪些应用。
	 */
	listExternalApplications(targetPath: string | null): Promise<PluginExternalApplication[]>;
	/** 用指定应用打开路径；`targetPath` 为 `null` 时只启动该应用。 */
	openPathWithApplication(
		targetPath: string | null,
		appId: string,
		kind: PluginExternalApplicationKind,
	): Promise<void>;
	/** 用系统默认应用打开路径。 */
	openPathWithDefaultApplication(targetPath: string): Promise<void>;
}
