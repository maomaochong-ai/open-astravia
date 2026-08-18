import {
	createTeam,
	fetchMyTeams,
	fetchTeamDetail,
	joinTeam,
	leaveTeam,
	removeTeamMember,
	resetTeamInviteCode,
	type TeamDetailVO,
	type TeamVO,
} from "@shared/lib/api";
import { authTokenAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export interface TeamSettingsLabels {
	loginRequired: string;
	description: string;
	members: string;
	joinViaCode: string;
	codeLabel: string;
	ownerRole: string;
	adminRole: string;
	memberRole: string;
	backToList: string;
	resetCode: string;
	memberCount: (count: number) => string;
	createTitle: string;
	createPlaceholder: string;
	createFailed: string;
	creating: string;
	createButton: string;
	joinTitle: string;
	joinPlaceholder: string;
	joinFailed: string;
	joining: string;
	joinButton: string;
	cancel: string;
}

export interface TeamSettingsModel {
	token: string | null;
	teams: TeamVO[];
	selectedTeam: TeamDetailVO | null;
	createOpen: boolean;
	joinOpen: boolean;
	loading: boolean;
	labels: TeamSettingsLabels;
	setCreateOpen: (open: boolean) => void;
	setJoinOpen: (open: boolean) => void;
	onSelectTeam: (teamId: number) => Promise<void>;
	onBack: () => void;
	onRefreshSelectedTeam: () => Promise<void>;
	onResetInviteCode: () => Promise<void>;
	onRemoveMember: (userId: number) => Promise<void>;
	onLeaveTeam: () => Promise<void>;
	onCreateTeam: (name: string) => Promise<void>;
	onJoinTeam: (code: string) => Promise<void>;
}

export function useTeamSettingsModel(): TeamSettingsModel {
	const { t } = useTranslation("settings");
	const token = useAtomValue(authTokenAtom);
	const [teams, setTeams] = useState<TeamVO[]>([]);
	const [selectedTeam, setSelectedTeam] = useState<TeamDetailVO | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [joinOpen, setJoinOpen] = useState(false);
	const loading = false;

	const refresh = useCallback(async () => {
		if (!token) return;
		const list = await fetchMyTeams(token);
		setTeams(list);
	}, [token]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const handleSelectTeam = useCallback(
		async (teamId: number) => {
			if (!token) return;
			const detail = await fetchTeamDetail(token, teamId);
			setSelectedTeam(detail);
		},
		[token],
	);

	const handleRefreshSelectedTeam = useCallback(async () => {
		if (!token || !selectedTeam) return;
		await refresh();
		const updated = await fetchTeamDetail(token, selectedTeam.id);
		setSelectedTeam(updated);
	}, [refresh, selectedTeam, token]);

	const handleResetInviteCode = useCallback(async () => {
		if (!token || !selectedTeam) return;
		await resetTeamInviteCode(token, selectedTeam.id);
		await handleRefreshSelectedTeam();
	}, [handleRefreshSelectedTeam, selectedTeam, token]);

	const handleRemoveMember = useCallback(
		async (userId: number) => {
			if (!token || !selectedTeam) return;
			await removeTeamMember(token, selectedTeam.id, userId);
			await handleRefreshSelectedTeam();
		},
		[handleRefreshSelectedTeam, selectedTeam, token],
	);

	const handleLeaveTeam = useCallback(async () => {
		if (!token || !selectedTeam) return;
		await leaveTeam(token, selectedTeam.id);
		setSelectedTeam(null);
	}, [selectedTeam, token]);

	const handleCreateTeam = useCallback(
		async (name: string) => {
			if (!token) return;
			await createTeam(token, name);
			await refresh();
			setCreateOpen(false);
		},
		[refresh, token],
	);

	const handleJoinTeam = useCallback(
		async (code: string) => {
			if (!token) return;
			await joinTeam(token, code);
			await refresh();
			setJoinOpen(false);
		},
		[refresh, token],
	);

	return {
		token,
		teams,
		selectedTeam,
		createOpen,
		joinOpen,
		loading,
		labels: {
			loginRequired: t("loginRequiredTeam"),
			description: t("teamCreateOrJoin", { members: t("teamMembers") }),
			members: t("teamMembers"),
			joinViaCode: t("teamJoinViaCode", { codeLabel: t("teamCodeLabel") }),
			codeLabel: t("teamCodeLabel"),
			ownerRole: t("teamOwner"),
			adminRole: t("teamAdmin"),
			memberRole: t("teamMember"),
			backToList: t("teamBackTo"),
			resetCode: t("teamResetCode"),
			memberCount: (count: number) => t("teamMemberCount", { count }),
			createTitle: t("teamCreate"),
			createPlaceholder: t("teamNamePlaceholder"),
			createFailed: t("teamCreateFailed"),
			creating: t("teamCreating"),
			createButton: t("teamCreateBtn"),
			joinTitle: t("teamJoin"),
			joinPlaceholder: t("teamCodePlaceholder"),
			joinFailed: t("teamJoinFailed"),
			joining: t("teamJoining"),
			joinButton: t("teamJoinBtn"),
			cancel: t("cancel"),
		},
		setCreateOpen,
		setJoinOpen,
		onSelectTeam: handleSelectTeam,
		onBack: () => setSelectedTeam(null),
		onRefreshSelectedTeam: handleRefreshSelectedTeam,
		onResetInviteCode: handleResetInviteCode,
		onRemoveMember: handleRemoveMember,
		onLeaveTeam: handleLeaveTeam,
		onCreateTeam: handleCreateTeam,
		onJoinTeam: handleJoinTeam,
	};
}
