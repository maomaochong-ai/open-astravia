import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { autoRejectActionApprovalAtom, enqueueActionApprovalAtom } from "../store/action-approval-atoms";

export function ActionApprovalCenter(): null {
	const enqueue = useSetAtom(enqueueActionApprovalAtom);
	const autoReject = useSetAtom(autoRejectActionApprovalAtom);

	useEffect(() => {
		const disposeRequest = window.astravia.actionApproval.onRequest((request) => {
			enqueue(request);
		});
		const disposeTimeout = window.astravia.actionApproval.onTimeout((event) => {
			autoReject(event.approvalId);
		});
		return () => {
			disposeRequest();
			disposeTimeout();
		};
	}, [autoReject, enqueue]);

	return null;
}
