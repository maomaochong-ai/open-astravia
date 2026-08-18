import { ipcMain } from "electron";
import type { ActionApprovalBroker } from "../app-actions/approval-broker.js";
import type { JsonValue } from "../app-actions/types.js";

const RESPONSE_CHANNEL = "vetta:action-approval:response";

export function registerActionApprovalIpc(broker: ActionApprovalBroker): () => void {
	ipcMain.handle(RESPONSE_CHANNEL, (_event, approvalId: unknown, approved: unknown, input: unknown) => {
		if (typeof approvalId !== "string" || approvalId.length === 0) {
			throw new Error("Invalid action approval id");
		}
		return broker.respond(approvalId, approved === true, input as JsonValue | undefined);
	});

	return () => {
		ipcMain.removeHandler(RESPONSE_CHANNEL);
		broker.dispose();
	};
}
