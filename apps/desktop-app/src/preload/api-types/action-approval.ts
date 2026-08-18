export type DesktopActionJsonPrimitive = string | number | boolean | null;
export type DesktopActionJsonValue =
	| DesktopActionJsonPrimitive
	| DesktopActionJsonValue[]
	| { [key: string]: DesktopActionJsonValue };

export interface DesktopActionApprovalRequest {
	approvalId: string;
	expiresAt: number;
	actionId: string;
	approvalPresentation: string;
	input: DesktopActionJsonValue;
	title: string;
	summary: string;
	permission: string;
}

export interface DesktopActionApprovalTimeoutEvent {
	approvalId: string;
}

export interface DesktopActionApprovalApi {
	onRequest(handler: (request: DesktopActionApprovalRequest) => void): () => void;
	onTimeout(handler: (event: DesktopActionApprovalTimeoutEvent) => void): () => void;
	respond(approvalId: string, approved: boolean, input?: DesktopActionJsonValue): Promise<boolean>;
}
