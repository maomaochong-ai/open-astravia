/**
 * 项目列表（desktop-config.json）变更广播：main → renderer。
 *
 * 渲染进程之外的项目增删（插件能力 `official.projects.*`、Action 等）只在主进程侧
 * 写配置，不会经过渲染进程的配置入口；没有这条广播时，渲染进程只能靠重启应用重新
 * `config.get()`，表现为侧栏看不到刚建好的项目。
 */
export const PROJECTS_CHANNELS = {
	/** main → renderer：项目列表已变更。无 payload，渲染端自行重读配置。 */
	CHANGED: "astravia:projects:changed",
} as const;
