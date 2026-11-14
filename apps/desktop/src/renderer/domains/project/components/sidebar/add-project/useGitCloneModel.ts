import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function useGitCloneModel(onCloned: (path: string) => void): {
	url: string;
	parentDir: string;
	cloning: boolean;
	error: string;
	canSubmit: boolean;
	setUrl: (value: string) => void;
	chooseParentDir: () => Promise<void>;
	submit: () => Promise<void>;
	cancel: () => void;
} {
	const { t } = useTranslation("project");
	const [url, setUrlState] = useState("");
	const [parentDir, setParentDir] = useState("");
	const [cloning, setCloning] = useState(false);
	const [error, setError] = useState("");
	const requestIdRef = useRef<string | null>(null);

	// 默认存到工作目录：与「新建项目」落点一致，用户通常不必再选。
	useEffect(() => {
		let alive = true;
		void window.astravia.project
			.list()
			.then((snapshot) => {
				if (alive) setParentDir((current) => current || snapshot.workspacePath);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, []);

	// 面板在克隆中被关掉（Esc、卸载）时，别让 git 在后台继续下载。
	useEffect(
		() => () => {
			if (requestIdRef.current) void window.astravia.project.cancelClone(requestIdRef.current);
		},
		[],
	);

	const setUrl = useCallback((value: string) => {
		setUrlState(value);
		setError("");
	}, []);

	const chooseParentDir = useCallback(async () => {
		const dir = await window.astravia.dialog.selectFolder();
		if (dir) {
			setParentDir(dir);
			setError("");
		}
	}, []);

	const trimmedUrl = url.trim();
	const canSubmit = !cloning && trimmedUrl.length > 0 && parentDir.length > 0;

	const submit = useCallback(async () => {
		if (!canSubmit) return;
		const requestId = crypto.randomUUID();
		requestIdRef.current = requestId;
		setCloning(true);
		setError("");
		try {
			const result = await window.astravia.project.clone({ requestId, url: trimmedUrl, parentDir });
			if ("error" in result) {
				if (result.error.code !== "cancelled") {
					setError(t(`gitCloneDialog.errors.${result.error.code}`, { message: result.error.message }));
				}
				return;
			}
			requestIdRef.current = null;
			onCloned(result.path);
		} catch (cause) {
			setError(
				t("gitCloneDialog.errors.clone-failed", {
					message: cause instanceof Error ? cause.message : String(cause),
				}),
			);
		} finally {
			requestIdRef.current = null;
			setCloning(false);
		}
	}, [canSubmit, trimmedUrl, parentDir, onCloned, t]);

	const cancel = useCallback(() => {
		if (requestIdRef.current) void window.astravia.project.cancelClone(requestIdRef.current);
	}, []);

	return { url, parentDir, cloning, error, canSubmit, setUrl, chooseParentDir, submit, cancel };
}
