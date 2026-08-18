/**
 * 项目列表变更广播。
 *
 * 项目列表的事实源是主进程的 desktop 配置，但渲染进程的侧边栏是自己缓存的一份快照，
 * 只在启动和用户亲手操作后重读。于是任何**不经过渲染进程**的写入（插件的
 * `official.projects.*`、Action、以及将来别的宿主入口）改完配置后侧边栏纹丝不动，
 * 要等重启才出现——这条广播就是补上那半条链路。
 *
 * 不带载荷：渲染进程收到信号后自己 `refreshProjects()` 重读配置，避免在 shared 层
 * 重复定义一份会与配置结构漂移的项目条目类型。
 */
export const PROJECTS_CHANNELS = {
	/** main → renderer：无载荷，仅通知「项目列表已变，去重读」。 */
	CHANGED: "vetta:projects:changed",
} as const;
