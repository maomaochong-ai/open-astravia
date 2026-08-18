import type { SessionInfo } from "@shared/store/atoms";
import { sessionDisplayLabel } from "@shared/store/atoms";
import type { SessionRenameInputViewProps } from "@vetta/theme-ui/project";
import { useCallback } from "react";

interface Args {
	cwd: string;
	onDone: () => void;
	onRename: (cwd: string, sessionPath: string, name: string) => void;
	session: SessionInfo;
}

export function useInlineSessionRenameModel({ cwd, onDone, onRename, session }: Args): SessionRenameInputViewProps {
	const initialValue = sessionDisplayLabel(session);

	const onCommit = useCallback(
		(value: string) => {
			onRename(cwd, session.path, value);
		},
		[cwd, onRename, session.path],
	);

	return {
		className:
			"min-w-0 flex-1 truncate rounded-[3px] border border-input bg-accent/50 pl-[20px] text-[13px] text-foreground outline-none",
		initialValue,
		onCancel: onDone,
		onCommit,
	};
}

export function useDefaultSessionRenameModel({
	onDone,
	onRename,
	session,
}: {
	onDone: () => void;
	onRename: (name: string) => void;
	session: SessionInfo;
}): SessionRenameInputViewProps {
	return {
		initialValue: sessionDisplayLabel(session),
		onCancel: onDone,
		onCommit: onRename,
	};
}
