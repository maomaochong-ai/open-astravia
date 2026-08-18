import type {
	SandboxPermissionContext,
	SandboxPermissionDecision,
	SandboxPermissionRequest,
} from "@vetta/runtime-core/sandbox";

export function isSensitiveSandboxRequest(
	request: SandboxPermissionRequest,
	isDeniedPath: (targetPath: string) => boolean,
): boolean {
	if (isDeniedPath(request.resolvedTarget)) return true;
	return request.grantRoot ? isDeniedPath(request.grantRoot) : false;
}

export async function confirmSandboxPermission(
	context: SandboxPermissionContext,
	request: SandboxPermissionRequest,
	isDeniedPath: (targetPath: string) => boolean,
): Promise<SandboxPermissionDecision> {
	if (typeof context.requestEcosystemPermission === "function") {
		try {
			const hookDecision = await context.requestEcosystemPermission({
				toolName: request.toolName,
				toolInput: {
					capability: request.capability,
					target: request.target,
					resolvedTarget: request.resolvedTarget,
					grantRoot: request.grantRoot,
					command: request.command,
					reason: request.reason,
				},
				runIdSuffix: `${request.capability}:${request.resolvedTarget}`,
			});
			if (hookDecision?.decision === "deny") {
				console.info("[ecosystem-hooks] PermissionRequest denied sandbox grant", {
					tool: request.toolName,
					capability: request.capability,
					message: hookDecision.message,
				});
				return "deny";
			}
			if (hookDecision?.decision === "allow") {
				console.info("[ecosystem-hooks] PermissionRequest allowed sandbox grant", {
					tool: request.toolName,
					capability: request.capability,
				});
				return "allow_once";
			}
		} catch (error) {
			console.warn("[ecosystem-hooks] PermissionRequest hook failed; falling through to UI", error);
		}
	}

	if (!context.hasUI) return "deny";
	const sensitive = isSensitiveSandboxRequest(request, isDeniedPath);
	const title = "沙箱权限请求";
	const lines = [
		`工具：${request.toolName}`,
		`权限：${request.capability}`,
		`目标：${request.target}`,
		`解析路径：${request.resolvedTarget}`,
		request.grantRoot ? `本次授权目录：${request.grantRoot}` : undefined,
		request.command ? `命令：${request.command}` : undefined,
		"",
		sensitive
			? "该路径为敏感路径，仅支持本次允许（不可缓存到本会话）。"
			: '"允许本次"仅对当前工具调用生效；"本会话不再询问"会缓存到本会话内同 grantRoot 的后续请求。',
	].filter((line): line is string => typeof line === "string");

	if (typeof context.ui.requestSandboxGrant === "function") {
		const decision = await context.ui.requestSandboxGrant({
			title,
			message: lines.join("\n"),
			toolName: request.toolName,
			capability: request.capability,
			target: request.target,
			resolvedTarget: request.resolvedTarget,
			grantRoot: request.grantRoot,
			command: request.command,
			sensitive,
		});
		if (decision === "allow_session" && sensitive) return "allow_once";
		return decision ?? "deny";
	}

	return (await context.ui.confirm(title, lines.join("\n"))) ? "allow_once" : "deny";
}
