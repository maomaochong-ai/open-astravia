import { ActionButtonBarView } from "@vetta/theme-ui/chat";
import { memo } from "react";
import { useActionButtonBarModel } from "../hooks/useActionButtonBarModel";

export const ActionButtonBar = memo(function ActionButtonBar(): JSX.Element | null {
	const model = useActionButtonBarModel();
	if (!model) return null;
	return <ActionButtonBarView buttons={model.buttons} onClick={model.onClick} />;
});
