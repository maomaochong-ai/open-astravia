import { DatabaseSettingsPanel } from "../../database/components/DatabaseSettingsPanel";

/**
 * 数据库设置面板入口（B2.6-Z）：设置中心「数据库」标签页渲染纯设置面板
 * （工具偏好 / 执行与安全 / AI 数据库协作开关），不再整页复用连接管理视图。
 * 连接管理（列表 / 详情 / 增删改）在 /database 连接管理页与活动面板工作台。
 */
export function DatabaseSettings(): JSX.Element {
	return <DatabaseSettingsPanel />;
}
