import { recordSettingsUsage } from "../../settings/components/recordSettingsUsage";
import { databaseTabTargetAtom, pendingDatabaseSqlActionAtom } from "@shared/store/atoms";
import { useAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DatabaseWorkspace } from "../../database/components/DatabaseWorkspace";
import type { ActivityTabDefinition } from "../registry/types";

function DatabaseActivityTab(): JSX.Element {
	// 打开数据库标签页埋点（B2.6-R）：组件随标签页激活挂载/卸载，挂载即打开。
	useEffect(() => {
		recordSettingsUsage({ tab: "database", action: "selected", target: "activity-tab" });
	}, []);
	// B2.7 对话→界面：快照固定到本帧，DatabaseWorkspace 的 initialApplied ref 保证连接/表只应用一次。
	// B2.9-W1：syncTarget 实时传递（含 sql/result 回填）；不再「挂载即清空」atom ——
	// V6-① 修复：工作台消费 syncTarget 需要等连接列表异步加载完成，挂载即清空会在
	// 加载未完成时把回填目标丢掉（竞态）。改由工作台消费成功后经 onSyncTargetApplied 清空。
	const [target, setTarget] = useAtom(databaseTabTargetAtom);
	const [snapshot] = useState(() => target);
	const handleSyncTargetApplied = useCallback(() => setTarget(null), [setTarget]);
	// P1：chat SQL 块动作 —— 与 target 同通道模式：实时订阅（已挂载时随 atom 变化触发），
	// 工作台消费后（或确认无法消费）经 onSqlActionApplied 清空，防残留重复执行。
	const [sqlAction, setSqlAction] = useAtom(pendingDatabaseSqlActionAtom);
	const handleSqlActionApplied = useCallback(() => setSqlAction(null), [setSqlAction]);
return (
		<DatabaseWorkspace
			initialConnection={snapshot?.connection}
			initialTable={snapshot?.table}
			syncTarget={target}
			onSyncTargetApplied={handleSyncTargetApplied}
			sqlAction={sqlAction}
			onSqlActionApplied={handleSqlActionApplied}
		/>
	);
}

/** 三栏经典数据库工具界面（B2.6-R 从 /database 路由迁入活动面板，数据工作台）。 */
export const databaseTabDefinition: ActivityTabDefinition = {
	id: "database",
	order: 5,
	removable: false,
	source: "builtin",
	useMeta: () => {
		const { t } = useTranslation("chat");
		return {
			label: t("activityPanel.tabs.database"),
			icon: "icon-[solar--database-linear]",
		};
	},
	component: DatabaseActivityTab,
};
