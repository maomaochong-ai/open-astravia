import type { ProjectSelection } from "./project-selection";

export interface PrepareProjectCwdInput {
	readonly selection: ProjectSelection;
	/** 没有待创建项目时直接用的目标 cwd。 */
	readonly contextCwd: string;
	readonly createProject: (name: string) => Promise<string>;
	/** 项目落盘后把选择换成真实项目，避免重试时又建一次。 */
	readonly onCreated: (cwd: string, name: string) => void;
	readonly onPreparingChange: (preparing: boolean) => void;
	readonly onError: (error: unknown) => void;
}

/**
 * 解析「这条消息到底发到哪个 cwd」，必要时先把待创建项目落盘。
 *
 * 延迟到发送这一刻才创建：用户在对话框里填完名字可能又改主意，那时不该在磁盘上
 * 留下空目录。失败返回 null——调用方据此放弃本次发送，输入内容与选择原样保留。
 */
export async function prepareProjectCwd(input: PrepareProjectCwdInput): Promise<string | null> {
	const { selection, contextCwd, createProject, onCreated, onPreparingChange, onError } = input;
	if (selection?.kind !== "pending-create") return contextCwd;

	onPreparingChange(true);
	try {
		const createdCwd = await createProject(selection.name);
		onCreated(createdCwd, selection.name);
		return createdCwd;
	} catch (error) {
		onError(error);
		return null;
	} finally {
		onPreparingChange(false);
	}
}
