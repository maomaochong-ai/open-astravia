import { AgentModeIconToggle } from "./AgentModeIconToggle";
import { AgentConfigurationButton } from "@domains/agent-configuration";
import { NewSessionProjectSelector } from "./project-selector/NewSessionProjectSelector";
import type { ProjectOption, ProjectSelection } from "./project-selector/project-selection";

interface NewSessionOptionsRowProps {
	readonly selection: ProjectSelection;
	readonly options: readonly ProjectOption[];
	readonly takenNames: readonly string[];
	readonly creatingProject: boolean;
	readonly onSelectProject: (cwd: string | null) => void;
	readonly onSelectPendingProject: (name: string) => void;
}

/**
 * hero 与输入框之间的会话前置选项：左边选项目，右边选工作模式。
 *
 * 工作模式原本挂在 hero 内部，那里可以被主题整块替换（`chat.newSessionHero`），
 * 而它是全 App 唯一的模式入口；搬到这一行后不再依赖 hero 的实现。
 */
export function NewSessionOptionsRow({
	selection,
	options,
	takenNames,
	creatingProject,
	onSelectProject,
	onSelectPendingProject,
}: NewSessionOptionsRowProps): JSX.Element {
	return (
		// 与 hero 标题、输入框卡片共用 max-w-2xl 且不加横向 padding：两枚 chip 都有可见容器，
		// 容器左缘直接压在标题文字的基线上，不需要光学补偿。
		<div className="mx-auto mb-4 flex w-full max-w-2xl items-center gap-2">
			<AgentModeIconToggle />
			<AgentConfigurationButton newSession />
			<NewSessionProjectSelector
				selection={selection}
				options={options}
				takenNames={takenNames}
				creating={creatingProject}
				onSelectProject={onSelectProject}
				onSelectPendingProject={onSelectPendingProject}
			/>
		</div>
	);
}
