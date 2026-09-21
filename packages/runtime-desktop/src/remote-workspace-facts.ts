/**
 * 远程项目注入系统提示词的工作区说明。
 *
 * 必须显式告诉模型项目不在本机，否则它会按本地经验行事：用 MCP 的文件系统服务去读
 * 项目路径（那些服务跑在本机，读到的是本机的同名路径或什么都读不到），或者建议用户
 * 在本地终端里执行命令。这类错误的表现是「看起来成功了但改错了机器」，比直接失败难查。
 *
 * 不做远端的技术栈探测：探测接口是同步的（见 coding-agent 的 WorkspaceFactsFileSource），
 * 而任何远端读取都要跨网络。与其给一份必然为空的「探测结果」，不如只讲清楚位置事实。
 */
export function renderRemoteWorkspaceFacts(remotePath: string): string {
	return [
		"# Workspace",
		"",
		`This project lives on a remote machine, at \`${remotePath}\` on that machine — not on the local computer.`,
		"",
		"- The built-in file and command tools operate on the remote machine. Use them for anything inside this project.",
		"- MCP servers, plugins and any other tooling run on the local computer and CANNOT see this project. " +
			"A local path that looks identical belongs to a different machine and a different repository.",
		"- Skill directories (`SKILL_DIR`), pasted images and other files this app hands you live on the LOCAL computer. " +
			"The read tool can open them, but commands run on the remote machine and cannot see them. " +
			"To run a script that ships with a skill, read it and write a copy into a temporary directory on the remote machine first, " +
			"then run that copy. Skills that belong to this project are already on the remote machine and need no copying.",
		"- Commands run as the remote login user with no sandbox. There is no separate approval layer on that side.",
		"- The search tools run ripgrep and fd on the remote machine. If one reports that the program is not installed there, " +
			"fall back to `grep` or `find` through the command tool.",
	].join("\n");
}
