import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Copy,
  Download,
  Clock3,
  KeyRound,
  ListTree,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Search,
  StretchHorizontal,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { api, setApiUserToken } from "./api";
import { buildGanttSchedule, daysBetween, formatDateLabel, getDateTone, getJapaneseHolidayName, isToday } from "./gantt";
import type { AdminUser, ApiToken, AssigneeType, AuthSession, CreatedApiToken, Group, GroupMember, Project, Task, TaskLog, TaskNode, TaskPriority, TaskStatus, User } from "./types";
import { buildTaskTree, flattenTaskTree, flattenVisibleTaskTree } from "./wbs";

const ganttPalette = ["#2563eb", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#be185d", "#4f46e5"];
const PERSONAL_WORKSPACE_ID = "personal";

function randomGanttColor(): string {
  return ganttPalette[Math.floor(Math.random() * ganttPalette.length)];
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function isPersonalGroup(group: Group | null | undefined): boolean {
  return group?.is_personal === true || group?.is_personal === 1 || group?.is_personal === "1";
}

function groupDisplayName(group: Group): string {
  return isPersonalGroup(group) ? "個人" : group.name;
}

function projectBelongsToWorkspace(project: Project, workspaceId: string): boolean {
  return workspaceId === PERSONAL_WORKSPACE_ID ? project.group_id === null : project.group_id === workspaceId;
}

function taskMatchesSearch(task: TaskNode, query: string): boolean {
  const target = [
    task.wbsNumber,
    task.title,
    task.description,
    task.acceptance_criteria,
    task.assignee_name,
    task.start_date,
    task.due_date,
    statusLabels[task.status],
    priorityLabels[task.priority],
    task.status,
    task.priority,
  ]
    .map(normalizeSearchText)
    .join(" ");

  return target.includes(query);
}

function filterTaskTree(nodes: TaskNode[], searchText: string): TaskNode[] {
  const query = normalizeSearchText(searchText.trim());
  if (!query) return nodes;

  return nodes.flatMap((node) => {
    const filteredChildren = filterTaskTree(node.children, query);
    if (taskMatchesSearch(node, query)) {
      return [{ ...node }];
    }
    if (filteredChildren.length > 0) {
      return [{ ...node, children: filteredChildren }];
    }
    return [];
  });
}

const statusLabels: Record<TaskStatus, string> = {
  todo: "未着手",
  ready: "着手可",
  in_progress: "作業中",
  blocked: "停止中",
  review: "レビュー",
  done: "完了",
};

const priorityLabels: Record<TaskPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "緊急",
};

const assigneeTypeLabels: Record<AssigneeType, string> = {
  human: "人間",
  ai: "AI",
};

const actorTypeLabels: Record<TaskLog["actor_type"], string> = {
  human: "人間",
  ai: "AI",
  system: "システム",
};

const logActionLabels: Record<string, string> = {
  created: "作成",
  updated: "更新",
  moved: "移動",
  deleted: "削除",
  child_created: "子タスク作成",
  claim: "担当開始",
  start: "作業開始",
  block: "停止",
  complete: "完了",
  report: "報告",
};

function formatLogAction(action: string): string {
  return logActionLabels[action] ?? action;
}

const apiErrorLabels: Record<string, string> = {
  "Internal server error.": "サーバー内部でエラーが発生しました。",
  "Not found.": "対象が見つかりません。",
  "Project not found.": "プロジェクトが見つかりません。",
  "Task not found.": "タスクが見つかりません。",
  "Parent task not found.": "親タスクが見つかりません。",
  "No fields to update.": "更新する項目がありません。",
  "Task cannot be moved under itself.": "タスクを自分自身の配下へ移動できません。",
  "Parent task must be in the same project.": "親タスクは同じプロジェクト内で選択してください。",
  "Task cannot be moved under its descendant.": "タスクを子孫タスクの配下へ移動できません。",
  "Invalid move direction.": "移動方向が正しくありません。",
  "Admin token is already configured.": "管理トークンはすでに作成済みです。",
  "Admin token must be at least 12 characters.": "管理トークンは12文字以上で入力してください。",
  "Invalid scopes.": "スコープの指定が正しくありません。",
  "Missing bearer token.": "AIトークンが指定されていません。",
  "Invalid bearer token.": "AIトークンが正しくありません。",
  "Invalid admin token.": "管理トークンが正しくありません。",
  "Admin token is not configured.": "管理トークンが未設定です。",
  "Invalid JSON body.": "JSON形式が正しくありません。",
  "Login required.": "ログインしてください。",
  "Invalid email.": "メールアドレスが正しくありません。",
  "Password must be at least 8 characters.": "パスワードは8文字以上で入力してください。",
  "Email is already registered.": "このメールアドレスは登録済みです。",
  "Invalid email or password.": "メールアドレスまたはパスワードが正しくありません。",
  "Group not found.": "グループが見つかりません。",
  "Group owner required.": "グループのオーナー権限が必要です。",
  "User not found.": "ユーザーが見つかりません。",
  "User name is already taken.": "このユーザー名はすでに使われています。",
  "Invalid current password.": "現在のパスワードが正しくありません。",
  "Owner cannot remove self.": "オーナー自身は削除できません。",
  "Invalid avatar image.": "アイコン画像が正しくありません。",
};

function formatErrorMessage(caught: unknown, fallback: string): string {
  if (!(caught instanceof Error)) return fallback;
  return apiErrorLabels[caught.message] ?? caught.message;
}

function userInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function UserAvatar({ user, name, color, image, large = false }: { user?: User; name?: string; color?: string; image?: string | null; large?: boolean }) {
  const displayName = name ?? user?.name ?? "";
  const avatarColor = color ?? user?.avatar_color ?? "#155eef";
  const avatarImage = image ?? user?.avatar_image ?? null;

  return (
    <span className={large ? "user-avatar large" : "user-avatar"} style={{ backgroundColor: avatarColor }}>
      {avatarImage ? <img src={avatarImage} alt="" /> : userInitial(displayName)}
    </span>
  );
}

async function resizeAvatarImage(file: File): Promise<string> {
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    image.src = URL.createObjectURL(file);
  });

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像を処理できませんでした。");

  const scale = Math.max(size / source.width, size / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  context.drawImage(source, (size - width) / 2, (size - height) / 2, width, height);
  URL.revokeObjectURL(source.src);

  return canvas.toDataURL("image/png");
}

export function App() {
  const isAdminPage = window.location.pathname.replace(/\/+$/, "").endsWith("/admin") || new URLSearchParams(window.location.search).has("admin");
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState(PERSONAL_WORKSPACE_ID);
  const [groupName, setGroupName] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountAvatarColor, setAccountAvatarColor] = useState("#155eef");
  const [accountAvatarImage, setAccountAvatarImage] = useState<string | null>(null);
  const [accountMessage, setAccountMessage] = useState("");
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberMessage, setMemberMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [recoveryIdentifier, setRecoveryIdentifier] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [selectedAdminUser, setSelectedAdminUser] = useState<AdminUser | null>(null);
  const [adminUserMessage, setAdminUserMessage] = useState("");
  const [adminRecoveryPassword, setAdminRecoveryPassword] = useState("");
  const [adminSuspendDays, setAdminSuspendDays] = useState(7);
  const [tokenHelpOpen, setTokenHelpOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [projectName, setProjectName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState("");
  const [editingProjectName, setEditingProjectName] = useState("");
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem("quick-wbs-admin-token") ?? "");
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
  const [newTokenName, setNewTokenName] = useState("");
  const [createdApiToken, setCreatedApiToken] = useState<CreatedApiToken | null>(null);
  const [tokenMessage, setTokenMessage] = useState("");
  const [adminConfigured, setAdminConfigured] = useState(true);
  const [adminTokenLocallySet, setAdminTokenLocallySet] = useState(() => Boolean(localStorage.getItem("quick-wbs-admin-token")));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"account" | "group" | "tokens">("account");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [childComposerParentId, setChildComposerParentId] = useState<string>("");
  const [childTitle, setChildTitle] = useState("");
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const tree = useMemo(() => buildTaskTree(tasks), [tasks]);
  const rows = useMemo(() => flattenTaskTree(tree), [tree]);
  const filteredTree = useMemo(() => filterTaskTree(tree, taskSearch), [tree, taskSearch]);
  const visibleRows = useMemo(
    () => flattenVisibleTaskTree(filteredTree, taskSearch.trim() ? new Set() : collapsedTaskIds),
    [filteredTree, collapsedTaskIds, taskSearch],
  );
  const hasTaskSearch = taskSearch.trim().length > 0;
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null;
  const isPersonalWorkspace = activeGroupId === PERSONAL_WORKSPACE_ID;
  const activeWorkspaceLabel = isPersonalWorkspace ? "個人" : activeGroup ? groupDisplayName(activeGroup) : "個人";
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const ganttSchedule = useMemo(() => buildGanttSchedule(tree, activeProject?.created_at ?? null), [tree, activeProject?.created_at]);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const parentOptions = useMemo(() => {
    if (!selectedTask) return [];

    const selectedNode = rows.find((task) => task.id === selectedTask.id);
    const excludedIds = new Set<string>([selectedTask.id]);
    if (selectedNode) {
      for (const id of collectDescendantIds(selectedNode)) {
        excludedIds.add(id);
      }
    }

    return rows.filter((task) => !excludedIds.has(task.id));
  }, [rows, selectedTask]);

  useEffect(() => {
    void loadAuth();
    void loadAdminSetup();
  }, []);

  useEffect(() => {
    if (authUser && activeGroupId) {
      void loadProjects(activeGroupId);
      void loadGroupMembers(activeGroupId);
    }
  }, [authUser, activeGroupId]);

  useEffect(() => {
    if (authUser && activeProjectId) {
      void loadTasks(activeProjectId);
    } else {
      setTasks([]);
      setSelectedTaskId("");
    }
  }, [authUser, activeProjectId]);

  useEffect(() => {
    if (authUser && settingsOpen && settingsTab === "tokens") {
      void loadApiTokens();
    }
  }, [authUser, settingsOpen, settingsTab]);

  useEffect(() => {
    const rootsWithoutColor = tasks.filter((task) => task.parent_id === null && !task.gantt_color);
    if (rootsWithoutColor.length === 0) return;

    const assignments = new Map(rootsWithoutColor.map((task) => [task.id, randomGanttColor()]));
    setTasks((current) =>
      current.map((task) => {
        const ganttColor = assignments.get(task.id);
        return ganttColor ? { ...task, gantt_color: ganttColor } : task;
      }),
    );

    for (const [taskId, ganttColor] of assignments) {
      void api.updateTask(taskId, { gantt_color: ganttColor }).catch(() => {
        setError("ガントチャートの初期色を保存できませんでした。");
      });
    }
  }, [tasks]);

  useEffect(() => {
    if (rows.length > 0 && (!selectedTaskId || !tasks.some((task) => task.id === selectedTaskId))) {
      setSelectedTaskId(rows[0].id);
    }
    if (rows.length === 0) {
      setSelectedTaskId("");
    }
  }, [rows, selectedTaskId, tasks]);

  useEffect(() => {
    if (selectedTask?.id) {
      void reloadLogs(selectedTask.id);
    } else {
      setLogs([]);
    }
  }, [selectedTask?.id]);

  async function run(action: () => Promise<void>) {
    setError("");
    setLoading(true);
    try {
      await action();
    } catch (caught) {
      setError(formatErrorMessage(caught, "処理に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  function applyAuthSession(session: AuthSession) {
    localStorage.setItem("quick-wbs-user-token", session.token);
    setApiUserToken(session.token);
    setAuthUser(session.user);
    setAccountName(session.user.name);
    setAccountAvatarColor(session.user.avatar_color);
    setAccountAvatarImage(session.user.avatar_image);
    setGroups(session.groups);
    setActiveGroupId((current) => current || PERSONAL_WORKSPACE_ID);
    setAuthError("");
  }

  async function loadAuth() {
    const token = localStorage.getItem("quick-wbs-user-token") ?? "";
    if (!token) {
      setAuthReady(true);
      return;
    }

    setApiUserToken(token);
    try {
      const session = await api.me();
      setAuthUser(session.user);
      setAccountName(session.user.name);
      setAccountAvatarColor(session.user.avatar_color);
      setAccountAvatarImage(session.user.avatar_image);
      setGroups(session.groups);
      setActiveGroupId((current) => current || PERSONAL_WORKSPACE_ID);
    } catch {
      localStorage.removeItem("quick-wbs-user-token");
      setApiUserToken("");
      setAuthUser(null);
      setGroups([]);
      setActiveGroupId(PERSONAL_WORKSPACE_ID);
    } finally {
      setAuthReady(true);
    }
  }

  async function submitAuth() {
    const email = authEmail.trim();
    const password = authPassword;
    const name = authName.trim();
    if (!email || !password || (authMode === "register" && !name)) {
      setAuthError("必要な項目を入力してください。");
      return;
    }

    setAuthError("");
    setLoading(true);
    try {
      const session = authMode === "register" ? await api.register(name, email, password) : await api.login(email, password);
      applyAuthSession(session);
      setAuthPassword("");
    } catch (caught) {
      setAuthError(formatErrorMessage(caught, "ログインに失敗しました。"));
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    localStorage.removeItem("quick-wbs-user-token");
    setApiUserToken("");
    setAuthUser(null);
    setGroups([]);
    setActiveGroupId(PERSONAL_WORKSPACE_ID);
    setAccountName("");
    setAccountAvatarColor("#155eef");
    setAccountAvatarImage(null);
    setAccountMessage("");
    setProjects([]);
    setTasks([]);
    setSelectedTaskId("");
  }

  async function updateAccount() {
    const name = accountName.trim();
    if (!name) {
      setAccountMessage("表示名を入力してください。");
      return;
    }

    setAccountMessage("");
    try {
      const user = await api.updateMe({ name, avatar_color: accountAvatarColor, avatar_image: accountAvatarImage });
      setAuthUser(user);
      setAccountName(user.name);
      setAccountAvatarColor(user.avatar_color);
      setAccountAvatarImage(user.avatar_image);
      setAccountMessage("アカウント設定を保存しました。");
    } catch (caught) {
      setAccountMessage(formatErrorMessage(caught, "アカウント設定の保存に失敗しました。"));
    }
  }

  async function changePassword() {
    if (!currentPassword || !newPassword || !newPasswordConfirm) {
      setPasswordMessage("現在のパスワードと新しいパスワードを2回入力してください。");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setPasswordMessage("新しいパスワードが一致しません。");
      return;
    }

    setPasswordMessage("");
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      localStorage.removeItem("quick-wbs-user-token");
      setApiUserToken("");
      setAuthUser(null);
      setGroups([]);
      setActiveGroupId("");
      setProjects([]);
      setTasks([]);
      setAuthError("パスワードを変更しました。新しいパスワードでログインしてください。");
    } catch (caught) {
      setPasswordMessage(formatErrorMessage(caught, "パスワード変更に失敗しました。"));
    }
  }

  async function resetUserPassword() {
    const token = adminToken.trim();
    const identifier = recoveryIdentifier.trim();
    if (!token || !identifier || !recoveryPassword) {
      setRecoveryMessage("管理トークン、対象ユーザー、新しいパスワードを入力してください。");
      return;
    }

    setRecoveryMessage("");
    try {
      await api.resetUserPassword(token, identifier, recoveryPassword);
      setRecoveryIdentifier("");
      setRecoveryPassword("");
      setRecoveryMessage("アカウント復旧用パスワードを設定しました。");
    } catch (caught) {
      setRecoveryMessage(formatErrorMessage(caught, "アカウント復旧に失敗しました。"));
    }
  }

  async function createGroup() {
    const name = groupName.trim();
    if (!name) return;
    await run(async () => {
      const group = await api.createGroup(name);
      setGroups((current) => [group, ...current]);
      setActiveGroupId(group.id);
      setGroupName("");
    });
  }

  async function loadGroupMembers(groupId = activeGroupId) {
    if (groupId === PERSONAL_WORKSPACE_ID) {
      setGroupMembers([]);
      return;
    }
    if (!groupId) return;
    try {
      setGroupMembers(await api.listGroupMembers(groupId));
    } catch {
      setGroupMembers([]);
    }
  }

  async function addGroupMember() {
    const email = memberEmail.trim();
    if (!activeGroupId || activeGroupId === PERSONAL_WORKSPACE_ID || !email) return;
    setMemberMessage("");
    try {
      setGroupMembers(await api.addGroupMember(activeGroupId, email));
      setMemberEmail("");
      setMemberMessage("メンバーを追加しました。");
    } catch (caught) {
      setMemberMessage(formatErrorMessage(caught, "メンバー追加に失敗しました。"));
    }
  }

  async function removeGroupMember(userId: string) {
    if (!activeGroupId || activeGroupId === PERSONAL_WORKSPACE_ID) return;
    setMemberMessage("");
    try {
      await api.removeGroupMember(activeGroupId, userId);
      setGroupMembers((current) => current.filter((member) => member.user_id !== userId));
      setMemberMessage("メンバーを削除しました。");
    } catch (caught) {
      setMemberMessage(formatErrorMessage(caught, "メンバー削除に失敗しました。"));
    }
  }

  async function updateActiveProjectGroup(groupId: string) {
    if (!activeProject) return;
    await run(async () => {
      const updated = await api.updateProject(activeProject.id, { group_id: groupId === PERSONAL_WORKSPACE_ID ? null : groupId });
      setProjects((current) => current.map((project) => (project.id === updated.id ? updated : project)).filter((project) => projectBelongsToWorkspace(project, activeGroupId)));
      if (!projectBelongsToWorkspace(updated, activeGroupId)) {
        setActiveProjectId("");
        setTasks([]);
      }
    });
  }

  async function loadProjects(groupId = activeGroupId) {
    await run(async () => {
      const nextProjects = await api.listProjects(groupId);
      setProjects(nextProjects);
      setActiveProjectId((current) => (nextProjects.some((project) => project.id === current) ? current : nextProjects[0]?.id || ""));
    });
  }

  async function loadTasks(projectId: string) {
    await run(async () => {
      const nextTasks = await api.listTasks(projectId);
      setTasks(nextTasks);
      setSelectedTaskId((current) => current || nextTasks[0]?.id || "");
    });
  }

  async function reloadLogs(taskId: string) {
    await api.listTaskLogs(taskId).then(setLogs).catch(() => setLogs([]));
  }

  function updateAdminTokenInput(value: string) {
    setAdminToken(value);
    setAdminTokenLocallySet(value.trim() !== "" && value === localStorage.getItem("quick-wbs-admin-token"));
  }

  async function loadAdminSetup() {
    try {
      const setup = await api.getAdminSetup();
      setAdminConfigured(setup.configured);
    } catch {
      setAdminConfigured(true);
    }
  }

  async function setupAdminToken() {
    const token = adminToken.trim();
    if (token.length < 12) {
      setTokenMessage("管理トークンは12文字以上で入力してください。");
      return;
    }

    setTokenMessage("");
    try {
      await api.setupAdminToken(token);
      localStorage.setItem("quick-wbs-admin-token", token);
      setAdminConfigured(true);
      setAdminTokenLocallySet(true);
      setTokenMessage("管理トークンを作成しました。");
      await loadAdminUsers(token);
    } catch (caught) {
      setTokenMessage(formatErrorMessage(caught, "管理トークンの作成に失敗しました。"));
    }
  }

  async function setLocalAdminToken() {
    const token = adminToken.trim();
    if (!token) {
      setTokenMessage("管理トークンを入力してください。");
      return;
    }

    setTokenMessage("");
    try {
      await api.listAdminApiTokens(token);
      localStorage.setItem("quick-wbs-admin-token", token);
      setAdminTokenLocallySet(true);
      setTokenMessage("管理トークンを設定しました。");
      await loadAdminUsers(token);
    } catch (caught) {
      setTokenMessage(formatErrorMessage(caught, "管理トークンの設定に失敗しました。"));
    }
  }

  async function loadAdminUsers(token = adminToken.trim()) {
    if (!token) {
      setAdminUserMessage("管理トークンを入力してください。");
      return;
    }

    setAdminUserMessage("");
    try {
      const users = await api.listAdminUsers(token);
      setAdminUsers(users);
      setSelectedAdminUser((current) => (current ? users.find((user) => user.id === current.id) ?? current : current));
    } catch (caught) {
      setAdminUserMessage(formatErrorMessage(caught, "ユーザ一覧の取得に失敗しました。"));
    }
  }

  async function openAdminUser(userId: string) {
    const token = adminToken.trim();
    if (!token) {
      setAdminUserMessage("管理トークンを入力してください。");
      return;
    }

    setAdminUserMessage("");
    setAdminRecoveryPassword("");
    try {
      setSelectedAdminUser(await api.getAdminUser(token, userId));
    } catch (caught) {
      setAdminUserMessage(formatErrorMessage(caught, "ユーザ詳細の取得に失敗しました。"));
    }
  }

  async function resetSelectedAdminUserPassword() {
    if (!selectedAdminUser) return;
    const token = adminToken.trim();
    if (!token || !adminRecoveryPassword) {
      setAdminUserMessage("管理トークンと新しいパスワードを入力してください。");
      return;
    }

    setAdminUserMessage("");
    try {
      await api.resetAdminUserPassword(token, selectedAdminUser.id, adminRecoveryPassword);
      setAdminRecoveryPassword("");
      setAdminUserMessage("復旧用パスワードを設定し、既存セッションを切断しました。");
      await loadAdminUsers(token);
      setSelectedAdminUser(await api.getAdminUser(token, selectedAdminUser.id));
    } catch (caught) {
      setAdminUserMessage(formatErrorMessage(caught, "パスワード復旧に失敗しました。"));
    }
  }

  async function updateSelectedAdminUserStatus(action: "suspend" | "disable" | "activate") {
    if (!selectedAdminUser) return;
    const token = adminToken.trim();
    if (!token) {
      setAdminUserMessage("管理トークンを入力してください。");
      return;
    }

    setAdminUserMessage("");
    try {
      const updated = await api.updateAdminUserStatus(token, selectedAdminUser.id, action, adminSuspendDays);
      setSelectedAdminUser(updated);
      setAdminUsers((current) => current.map((user) => (user.id === updated.id ? updated : user)));
      setAdminUserMessage(action === "activate" ? "アカウントを再有効化しました。" : "アカウント状態を更新し、既存セッションを切断しました。");
    } catch (caught) {
      setAdminUserMessage(formatErrorMessage(caught, "アカウント状態の更新に失敗しました。"));
    }
  }

  async function loadApiTokens() {
    setTokenMessage("");
    try {
      const tokens = await api.listApiTokens();
      setApiTokens(tokens);
      setCreatedApiToken(null);
    } catch (caught) {
      setTokenMessage(formatErrorMessage(caught, "AIトークン一覧の取得に失敗しました。"));
    }
  }

  async function createAgentToken() {
    const name = newTokenName.trim();
    if (!name) {
      setTokenMessage("AI名を入力してください。");
      return;
    }

    setTokenMessage("");
    try {
      const created = await api.createApiToken(name);
      setCreatedApiToken(created);
      setNewTokenName("");
      setApiTokens(await api.listApiTokens());
    } catch (caught) {
      setTokenMessage(formatErrorMessage(caught, "AIトークンの作成に失敗しました。"));
    }
  }

  async function revokeAgentToken(tokenId: number) {
    setTokenMessage("");
    try {
      await api.revokeApiToken(tokenId);
      setApiTokens(await api.listApiTokens());
    } catch (caught) {
      setTokenMessage(formatErrorMessage(caught, "AIトークンの失効に失敗しました。"));
    }
  }

  async function createProject() {
    const name = projectName.trim();
    if (!name || !activeGroupId) return;
    await run(async () => {
      const project = await api.createProject(name, activeGroupId === PERSONAL_WORKSPACE_ID ? undefined : activeGroupId);
      setProjectName("");
      setProjects((current) => [project, ...current]);
      setActiveProjectId(project.id);
    });
  }

  function startProjectEdit(project: Project) {
    setEditingProjectId(project.id);
    setEditingProjectName(project.name);
  }

  function cancelProjectEdit() {
    setEditingProjectId("");
    setEditingProjectName("");
  }

  async function updateProjectName(project: Project) {
    const name = editingProjectName.trim();
    if (!name || name === project.name) {
      cancelProjectEdit();
      return;
    }

    await run(async () => {
      const updated = await api.updateProject(project.id, { name });
      setProjects((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      cancelProjectEdit();
    });
  }

  async function deleteProject(project: Project) {
    await run(async () => {
      await api.deleteProject(project.id);
      const nextProjects = projects.filter((item) => item.id !== project.id);
      setProjects(nextProjects);
      setProjectToDelete(null);
      cancelProjectEdit();
      if (activeProjectId === project.id) {
        const nextActiveProjectId = nextProjects[0]?.id ?? "";
        setActiveProjectId(nextActiveProjectId);
        if (!nextActiveProjectId) {
          setTasks([]);
          setSelectedTaskId("");
        }
      }
    });
  }

  async function createRootTask() {
    const title = taskTitle.trim();
    if (!title || !activeProjectId) return;
    await run(async () => {
      const task = await api.createTask(activeProjectId, title, undefined, { gantt_color: randomGanttColor() });
      setTaskTitle("");
      setTasks((current) => [...current, task]);
      setSelectedTaskId(task.id);
      await reloadLogs(task.id);
    });
  }

  function startChildComposer(parent: TaskNode) {
    setSelectedTaskId(parent.id);
    setCollapsedTaskIds((current) => {
      const next = new Set(current);
      next.delete(parent.id);
      return next;
    });
    setChildComposerParentId(parent.id);
    setChildTitle("");
  }

  function cancelChildComposer() {
    setChildComposerParentId("");
    setChildTitle("");
  }

  async function createChildTask(parent: TaskNode) {
    const title = childTitle.trim();
    if (!title) return;

    await run(async () => {
      const task = await api.createTask(parent.project_id, title, parent.id);
      setTasks((current) => [...current, task]);
      setSelectedTaskId(task.id);
      cancelChildComposer();
      await reloadLogs(task.id);
    });
  }

  async function updateTask(taskId: string, patch: Partial<Task>) {
    await run(async () => {
      const updated = await api.updateTask(taskId, patch);
      setTasks((current) => current.map((task) => (task.id === taskId ? updated : task)));
      if (patch.parent_id) {
        setCollapsedTaskIds((current) => {
          const next = new Set(current);
          next.delete(patch.parent_id!);
          return next;
        });
      }
      if (selectedTaskId === taskId) {
        await reloadLogs(taskId);
      }
    });
  }

  function toggleCollapsed(taskId: string) {
    setCollapsedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  async function moveTask(task: TaskNode, direction: "up" | "down") {
    await run(async () => {
      const nextTasks = await api.moveTask(task.id, direction);
      setTasks(nextTasks);
      setSelectedTaskId(task.id);
    });
  }

  async function deleteTask(task: TaskNode | Task) {
    const message =
      "このタスクを削除します。子タスクがある場合は子タスクも削除されます。\n\n" +
      `対象: ${task.title}`;
    if (!window.confirm(message)) return;

    await run(async () => {
      await api.deleteTask(task.id);
      const nextTasks = activeProjectId ? await api.listTasks(activeProjectId) : [];
      setTasks(nextTasks);
      setSelectedTaskId((current) => {
        if (current !== task.id) return current;
        return nextTasks[0]?.id ?? "";
      });
      if (childComposerParentId === task.id) {
        cancelChildComposer();
      }
    });
  }

  if (isAdminPage) {
    return (
      <>
        <AdminPage
          adminToken={adminToken}
          adminConfigured={adminConfigured}
          adminTokenLocallySet={adminTokenLocallySet}
          users={adminUsers}
          selectedUser={selectedAdminUser}
          message={adminUserMessage || tokenMessage}
          recoveryPassword={adminRecoveryPassword}
          suspendDays={adminSuspendDays}
          onAdminTokenChange={updateAdminTokenInput}
          onSetup={setupAdminToken}
          onSetLocal={setLocalAdminToken}
          onLoadUsers={() => void loadAdminUsers()}
          onOpenUser={(userId) => void openAdminUser(userId)}
          onCloseUser={() => setSelectedAdminUser(null)}
          onRecoveryPasswordChange={setAdminRecoveryPassword}
          onSuspendDaysChange={setAdminSuspendDays}
          onResetPassword={resetSelectedAdminUserPassword}
          onUpdateStatus={updateSelectedAdminUserStatus}
        />
      </>
    );
  }

  if (!authReady) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">Quick WBS</p>
          <h1>読み込み中</h1>
        </section>
      </main>
    );
  }

  if (!authUser) {
    return (
      <AuthScreen
        mode={authMode}
        name={authName}
        email={authEmail}
        password={authPassword}
        error={authError}
        loading={loading}
        onModeChange={setAuthMode}
        onNameChange={setAuthName}
        onEmailChange={setAuthEmail}
        onPasswordChange={setAuthPassword}
        onSubmit={submitAuth}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Quick WBS</p>
          <h1>開発タスク管理</h1>
        </div>
        <div className="topbar-actions">
          <button
            className="user-badge"
            onClick={() => {
              setSettingsTab("account");
              setSettingsOpen(true);
            }}
            title="アカウント設定"
          >
            <UserAvatar user={authUser} />
            <span>{authUser.name}</span>
          </button>
          <button className="icon-button" onClick={() => activeProjectId && loadTasks(activeProjectId)} title="更新">
            <RefreshCw size={18} />
          </button>
          <button className="text-button" onClick={() => void logout()}>
            ログアウト
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="panel-heading">
            <UserRound size={18} />
            <span>グループ</span>
          </div>
          <select
            value={activeGroupId}
            onChange={(event) => {
              setActiveGroupId(event.target.value);
              setActiveProjectId("");
              cancelChildComposer();
            }}
          >
            <option value={PERSONAL_WORKSPACE_ID}>個人</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {groupDisplayName(group)}
              </option>
            ))}
          </select>
          <div className="inline-form group-form">
            <input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createGroup();
              }}
              placeholder="新しいグループ"
            />
            <button className="icon-button primary" onClick={() => void createGroup()} title="グループ追加">
              <Plus size={18} />
            </button>
          </div>
          <div className="panel-heading">
            <ListTree size={18} />
            <span>プロジェクト</span>
          </div>
          <p className="subtle sidebar-note">{activeWorkspaceLabel} のプロジェクト</p>
          <div className="inline-form">
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createProject();
              }}
              placeholder="新規プロジェクト"
            />
            <button className="icon-button primary" onClick={createProject} title="プロジェクト追加">
              <Plus size={18} />
            </button>
          </div>
          <div className="project-list">
            {projects.map((project) => {
              const editing = editingProjectId === project.id;
              return (
                <div key={project.id} className={project.id === activeProjectId ? "project-item active" : "project-item"}>
                  {editing ? (
                    <>
                      <input
                        value={editingProjectName}
                        onChange={(event) => setEditingProjectName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void updateProjectName(project);
                          if (event.key === "Escape") cancelProjectEdit();
                        }}
                        autoFocus
                      />
                      <button className="icon-button" onClick={() => void updateProjectName(project)} title="保存">
                        <CheckCircle2 size={16} />
                      </button>
                      <button className="icon-button" onClick={cancelProjectEdit} title="キャンセル">
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="project-name-button"
                        onClick={() => {
                          setActiveProjectId(project.id);
                          setSelectedTaskId("");
                          cancelChildComposer();
                        }}
                      >
                        {project.name}
                      </button>
                      <button className="icon-button project-action" onClick={() => startProjectEdit(project)} title="プロジェクト名を編集">
                        <Pencil size={15} />
                      </button>
                      <button className="icon-button project-action danger" onClick={() => setProjectToDelete(project)} title="プロジェクトを削除">
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <button
            className="settings-button"
            onClick={() => {
              setSettingsTab("account");
              setSettingsOpen(true);
              void loadGroupMembers();
            }}
          >
            <Settings size={17} />
            設定
          </button>
        </aside>

        <section className="main-panel">
          <DueAlerts schedule={ganttSchedule} onSelectTask={setSelectedTaskId} />
          <div className="toolbar">
            <div className="inline-form wide">
              <input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createRootTask();
                }}
                placeholder="ルートタスクを追加"
              />
              <button className="text-button primary" onClick={createRootTask}>
                <Plus size={17} />
                追加
              </button>
            </div>
            <div className="task-search">
              <Search size={16} />
              <input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="タスクを検索" />
              {hasTaskSearch && (
                <button className="icon-button clear-search" onClick={() => setTaskSearch("")} title="検索をクリア">
                  <X size={16} />
                </button>
              )}
            </div>
            {loading && <span className="subtle">処理中...</span>}
            {error && <span className="error">{error}</span>}
          </div>
          {hasTaskSearch && (
            <div className="filter-summary">
              <span>
                検索結果 {visibleRows.length} / {rows.length} 件
              </span>
            </div>
          )}

          <div className="table-wrap">
            <table className="wbs-table">
              <thead>
                <tr>
                  <th>WBS</th>
                  <th>タスク</th>
                  <th>状態</th>
                  <th>優先</th>
                  <th>担当</th>
                  <th>期限</th>
                  <th>進捗</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((task) => (
                  <Fragment key={task.id}>
                    <TaskRow
                      task={task}
                      selected={selectedTask?.id === task.id}
                      collapsed={collapsedTaskIds.has(task.id)}
                      hasChildren={task.children.length > 0}
                      onSelect={() => setSelectedTaskId(task.id)}
                      onToggleCollapse={() => toggleCollapsed(task.id)}
                      onCreateChild={() => startChildComposer(task)}
                      onMoveUp={() => moveTask(task, "up")}
                      onMoveDown={() => moveTask(task, "down")}
                      onDelete={() => deleteTask(task)}
                      onUpdate={(patch) => updateTask(task.id, patch)}
                    />
                    {childComposerParentId === task.id && (
                      <ChildTaskComposer
                        key={`${task.id}-child-composer`}
                        depth={task.depth + 1}
                        value={childTitle}
                        onChange={setChildTitle}
                        onCancel={cancelChildComposer}
                        onSubmit={() => createChildTask(task)}
                      />
                    )}
                  </Fragment>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty">
                      プロジェクトを作成し、タスクを追加してください。
                    </td>
                  </tr>
                )}
                {rows.length > 0 && visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty">
                      一致するタスクがありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <GanttChart schedule={ganttSchedule} projectName={activeProject?.name ?? "Quick WBS"} onSelectTask={setSelectedTaskId} />
        </section>

        <aside className="detail-panel">
          <div className="panel-heading">
            <CircleDot size={18} />
            <span>タスク詳細</span>
          </div>
          {selectedTask ? (
            <TaskDetail
              key={selectedTask.id}
              task={selectedTask}
              logs={logs}
              parentOptions={parentOptions}
              onDelete={() => deleteTask(selectedTask)}
              onUpdate={(patch) => updateTask(selectedTask.id, patch)}
            />
          ) : (
            <p className="subtle">タスクを選択してください。</p>
          )}
        </aside>
      </section>
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)}>
          <SettingsTabs active={settingsTab} onChange={setSettingsTab} />
          {settingsTab === "account" && (
            <AccountPanel
              user={authUser}
              name={accountName}
              avatarColor={accountAvatarColor}
              avatarImage={accountAvatarImage}
              message={accountMessage}
              currentPassword={currentPassword}
              newPassword={newPassword}
              newPasswordConfirm={newPasswordConfirm}
              passwordMessage={passwordMessage}
              onNameChange={setAccountName}
              onAvatarColorChange={setAccountAvatarColor}
              onAvatarImageChange={setAccountAvatarImage}
              onCurrentPasswordChange={setCurrentPassword}
              onNewPasswordChange={setNewPassword}
              onNewPasswordConfirmChange={setNewPasswordConfirm}
              onSave={updateAccount}
              onChangePassword={changePassword}
            />
          )}
          {settingsTab === "group" && (
            <GroupMembersPanel
              group={activeGroup}
              currentUser={authUser}
              members={groupMembers}
              email={memberEmail}
              message={memberMessage}
              activeProject={activeProject}
              groups={groups}
              onEmailChange={setMemberEmail}
              onAdd={addGroupMember}
              onRemove={removeGroupMember}
              onProjectGroupChange={updateActiveProjectGroup}
            />
          )}
          {settingsTab === "tokens" && (
            <TokenPanel
              tokens={apiTokens}
              newTokenName={newTokenName}
              createdToken={createdApiToken}
              message={tokenMessage}
              onTokenNameChange={setNewTokenName}
              onLoad={loadApiTokens}
              onCreate={createAgentToken}
              onRevoke={revokeAgentToken}
              onHelp={() => setTokenHelpOpen(true)}
            />
          )}
        </SettingsModal>
      )}
      {tokenHelpOpen && <TokenHelpModal onClose={() => setTokenHelpOpen(false)} />}
      {projectToDelete && (
        <ConfirmModal
          title="プロジェクトを削除"
          message={`「${projectToDelete.name}」を削除します。含まれるタスクも一覧から表示されなくなります。`}
          confirmLabel="削除"
          onCancel={() => setProjectToDelete(null)}
          onConfirm={() => void deleteProject(projectToDelete)}
        />
      )}
    </main>
  );
}

function DueAlerts({
  schedule,
  onSelectTask,
}: {
  schedule: ReturnType<typeof buildGanttSchedule>;
  onSelectTask: (taskId: string) => void;
}) {
  if (!schedule) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueAlerts = schedule.items
    .filter((item) => item.dueDate && item.status !== "done")
    .map((item) => ({ item, daysLeft: daysBetween(today, item.dueDate!) }))
    .filter(({ item, daysLeft }) => item.dueDate! < today || daysLeft <= 7)
    .sort((left, right) => left.item.dueDate!.getTime() - right.item.dueDate!.getTime())
    .slice(0, 5);

  if (dueAlerts.length === 0) return null;

  return (
    <div className="gantt-alerts">
      {dueAlerts.map(({ item, daysLeft }) => (
        <button
          key={item.id}
          className={`gantt-alert ${item.dueDate! < today ? "overdue" : "soon"}`}
          onClick={() => onSelectTask(item.id)}
        >
          <span className="gantt-color-dot" style={{ backgroundColor: item.color }} />
          <span className="mono">{item.wbsNumber}</span>
          <strong>{item.title}</strong>
          <span>{item.dueDate! < today ? "期限超過" : `あと${daysLeft}日`}</span>
        </button>
      ))}
    </div>
  );
}

function AuthScreen({
  mode,
  name,
  email,
  password,
  error,
  loading,
  onModeChange,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: {
  mode: "login" | "register";
  name: string;
  email: string;
  password: string;
  error: string;
  loading: boolean;
  onModeChange: (mode: "login" | "register") => void;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Quick WBS</p>
        <h1>{mode === "register" ? "アカウント作成" : "ログイン"}</h1>
        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => onModeChange("login")}>
            ログイン
          </button>
          <button className={mode === "register" ? "active" : ""} onClick={() => onModeChange("register")}>
            新規登録
          </button>
        </div>
        <div className="auth-form">
          {mode === "register" && (
            <label>
              名前
              <input value={name} onChange={(event) => onNameChange(event.target.value)} autoComplete="name" />
            </label>
          )}
          <label>
            メールアドレス
            <input value={email} onChange={(event) => onEmailChange(event.target.value)} type="email" autoComplete="email" />
          </label>
          <label>
            パスワード
            <input
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSubmit();
              }}
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="text-button primary" onClick={onSubmit} disabled={loading}>
            {loading ? "処理中..." : mode === "register" ? "作成" : "ログイン"}
          </button>
        </div>
      </section>
    </main>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-heading">
          <Trash2 size={18} />
          <span>{title}</span>
        </div>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="text-button" onClick={onCancel}>
            キャンセル
          </button>
          <button className="text-button danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsModal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="設定" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-modal-header">
          <div className="panel-heading">
            <Settings size={18} />
            <span>設定</span>
          </div>
          <button className="icon-button" onClick={onClose} title="閉じる">
            <X size={17} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function SettingsTabs({
  active,
  onChange,
}: {
  active: "account" | "group" | "tokens";
  onChange: (tab: "account" | "group" | "tokens") => void;
}) {
  const tabs: Array<{ id: "account" | "group" | "tokens"; label: string }> = [
    { id: "account", label: "アカウント" },
    { id: "group", label: "グループ" },
    { id: "tokens", label: "AIトークン" },
  ];

  return (
    <div className="settings-tabs">
      {tabs.map((tab) => (
        <button key={tab.id} className={active === tab.id ? "active" : ""} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function AccountPanel({
  user,
  name,
  avatarColor,
  avatarImage,
  message,
  currentPassword,
  newPassword,
  newPasswordConfirm,
  passwordMessage,
  onNameChange,
  onAvatarColorChange,
  onAvatarImageChange,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onNewPasswordConfirmChange,
  onSave,
  onChangePassword,
}: {
  user: User;
  name: string;
  avatarColor: string;
  avatarImage: string | null;
  message: string;
  currentPassword: string;
  newPassword: string;
  newPasswordConfirm: string;
  passwordMessage: string;
  onNameChange: (value: string) => void;
  onAvatarColorChange: (value: string) => void;
  onAvatarImageChange: (value: string | null) => void;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onNewPasswordConfirmChange: (value: string) => void;
  onSave: () => void;
  onChangePassword: () => void;
}) {
  const [imageError, setImageError] = useState("");

  async function handleImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("画像ファイルを選択してください。");
      return;
    }

    try {
      const resized = await resizeAvatarImage(file);
      onAvatarImageChange(resized);
      setImageError("");
    } catch (caught) {
      setImageError(formatErrorMessage(caught, "画像の読み込みに失敗しました。"));
    }
  }

  return (
    <section className="account-panel">
      <div className="panel-heading">
        <UserRound size={18} />
        <span>アカウント</span>
      </div>
      <div className="account-preview">
        <UserAvatar name={name} color={avatarColor} image={avatarImage} large />
        <div>
          <strong>{name || user.name}</strong>
          <span>{user.email}</span>
        </div>
      </div>
      <label>
        表示名
        <input value={name} onChange={(event) => onNameChange(event.target.value)} />
      </label>
      <label>
        アイコン色
        <div className="color-control">
          <input type="color" value={avatarColor} onChange={(event) => onAvatarColorChange(event.target.value)} />
          <span className="color-value">{avatarColor}</span>
        </div>
      </label>
      <label>
        アイコン画像
        <input type="file" accept="image/*" onChange={(event) => void handleImage(event.target.files?.[0])} />
      </label>
      <div className="avatar-actions">
        <button className="text-button" onClick={() => onAvatarImageChange(null)}>
          画像を削除
        </button>
      </div>
      {imageError && <p className="token-message">{imageError}</p>}
      <div className="token-actions">
        <button className="text-button primary" onClick={onSave}>
          保存
        </button>
      </div>
      {message && <p className="token-message">{message}</p>}
      <div className="settings-subsection">
        <div className="panel-heading compact">
          <KeyRound size={16} />
          <span>パスワード変更</span>
        </div>
        <label>
          現在のパスワード
          <input type="password" value={currentPassword} onChange={(event) => onCurrentPasswordChange(event.target.value)} />
        </label>
        <label>
          新しいパスワード
          <input type="password" value={newPassword} onChange={(event) => onNewPasswordChange(event.target.value)} />
        </label>
        <label>
          新しいパスワード（確認）
          <input type="password" value={newPasswordConfirm} onChange={(event) => onNewPasswordConfirmChange(event.target.value)} />
        </label>
        <div className="token-actions">
          <button className="text-button" onClick={onChangePassword}>
            パスワード変更
          </button>
        </div>
        {passwordMessage && <p className="token-message">{passwordMessage}</p>}
      </div>
    </section>
  );
}

function GroupMembersPanel({
  group,
  currentUser,
  members,
  email,
  message,
  activeProject,
  groups,
  onEmailChange,
  onAdd,
  onRemove,
  onProjectGroupChange,
}: {
  group: Group | null;
  currentUser: User;
  members: GroupMember[];
  email: string;
  message: string;
  activeProject: Project | null;
  groups: Group[];
  onEmailChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (userId: string) => void;
  onProjectGroupChange: (groupId: string) => void;
}) {
  const personal = group === null || isPersonalGroup(group);
  const canManage = group?.role === "owner" && !personal;
  const projectShareValue = activeProject?.group_id && groups.some((item) => item.id === activeProject.group_id) ? activeProject.group_id : PERSONAL_WORKSPACE_ID;

  return (
    <section className="group-members-panel">
      <div className="panel-heading">
        <UserRound size={18} />
        <span>グループメンバー</span>
      </div>
      <>
          {activeProject && (
            <div className="project-group-control">
              <label>
                このプロジェクトの共有先
                <select value={projectShareValue} onChange={(event) => onProjectGroupChange(event.target.value)}>
                  <option value={PERSONAL_WORKSPACE_ID}>個人</option>
                  {groups.map((item) => (
                    <option key={item.id} value={item.id}>
                      {groupDisplayName(item)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <p className="subtle">{personal ? "個人プロジェクトは自分専用です。共有する場合は、このプロジェクトの共有先をグループに変更してください。" : group.name}</p>
          {canManage && (
            <div className="inline-form">
              <input
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onAdd();
                }}
                placeholder="メールアドレスまたはユーザー名"
              />
              <button className="icon-button primary" onClick={onAdd} title="メンバー追加">
                <Plus size={18} />
              </button>
            </div>
          )}
          <div className="member-list">
            {members.map((member) => (
              <div className="member-item" key={member.user_id}>
                <UserAvatar name={member.name} color={member.avatar_color} image={member.avatar_image} />
                <div>
                  <strong>{member.name}</strong>
                  <span>
                    {member.email} / {member.role === "owner" ? "オーナー" : "メンバー"}
                  </span>
                </div>
                {canManage && member.role !== "owner" && member.user_id !== currentUser.id && (
                  <button className="text-button danger" onClick={() => onRemove(member.user_id)}>
                    削除
                  </button>
                )}
              </div>
            ))}
          </div>
          {message && <p className="token-message">{message}</p>}
      </>
    </section>
  );
}

function AdminPage({
  adminToken,
  adminConfigured,
  adminTokenLocallySet,
  users,
  selectedUser,
  message,
  recoveryPassword,
  suspendDays,
  onAdminTokenChange,
  onSetup,
  onSetLocal,
  onLoadUsers,
  onOpenUser,
  onCloseUser,
  onRecoveryPasswordChange,
  onSuspendDaysChange,
  onResetPassword,
  onUpdateStatus,
}: {
  adminToken: string;
  adminConfigured: boolean;
  adminTokenLocallySet: boolean;
  users: AdminUser[];
  selectedUser: AdminUser | null;
  message: string;
  recoveryPassword: string;
  suspendDays: number;
  onAdminTokenChange: (value: string) => void;
  onSetup: () => void;
  onSetLocal: () => void;
  onLoadUsers: () => void;
  onOpenUser: (userId: string) => void;
  onCloseUser: () => void;
  onRecoveryPasswordChange: (value: string) => void;
  onSuspendDaysChange: (value: number) => void;
  onResetPassword: () => void;
  onUpdateStatus: (action: "suspend" | "disable" | "activate") => void;
}) {
  return (
    <main className="admin-shell">
      <section className="admin-page-card">
        <div className="settings-modal-header">
          <div>
            <p className="eyebrow">Quick WBS</p>
            <h1>管理者ページ</h1>
          </div>
          <a className="text-button" href="/">
            アプリへ戻る
          </a>
        </div>
        <AdminUsersPanel
          adminToken={adminToken}
          adminConfigured={adminConfigured}
          adminTokenLocallySet={adminTokenLocallySet}
          users={users}
          message={message}
          onAdminTokenChange={onAdminTokenChange}
          onSetLocal={onSetLocal}
          onSetup={onSetup}
          onLoadUsers={onLoadUsers}
          onOpenUser={onOpenUser}
        />
      </section>
      {selectedUser && (
        <AdminUserDetailModal
          user={selectedUser}
          recoveryPassword={recoveryPassword}
          suspendDays={suspendDays}
          message={message}
          onClose={onCloseUser}
          onRecoveryPasswordChange={onRecoveryPasswordChange}
          onSuspendDaysChange={onSuspendDaysChange}
          onResetPassword={onResetPassword}
          onUpdateStatus={onUpdateStatus}
        />
      )}
    </main>
  );
}

function AdminUsersPanel({
  adminToken,
  adminConfigured,
  adminTokenLocallySet,
  users,
  message,
  onAdminTokenChange,
  onSetLocal,
  onSetup,
  onLoadUsers,
  onOpenUser,
}: {
  adminToken: string;
  adminConfigured: boolean;
  adminTokenLocallySet: boolean;
  users: AdminUser[];
  message: string;
  onAdminTokenChange: (value: string) => void;
  onSetLocal: () => void;
  onSetup: () => void;
  onLoadUsers: () => void;
  onOpenUser: (userId: string) => void;
}) {
  const adminAction = adminConfigured ? onSetLocal : onSetup;
  const adminActionLabel = adminConfigured ? "設定" : "作成";

  return (
    <section className="admin-panel">
      <div className="panel-heading">
        <KeyRound size={18} />
        <span>管理</span>
      </div>
      <label>
        管理トークン
        <div className="admin-token-row">
          <input type="password" value={adminToken} onChange={(event) => onAdminTokenChange(event.target.value)} />
          <button className="text-button primary" onClick={adminAction} disabled={adminConfigured && adminTokenLocallySet}>
            {adminActionLabel}
          </button>
        </div>
      </label>
      <div className="token-actions">
        <button className="text-button" onClick={onLoadUsers}>
          ユーザ一覧を更新
        </button>
      </div>
      {message && <p className="token-message">{message}</p>}
      <div className="admin-user-list">
        {users.map((user) => (
          <button className="admin-user-row" key={user.id} onClick={() => onOpenUser(user.id)}>
            <UserAvatar name={user.name} color={user.avatar_color} image={user.avatar_image} />
            <span>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
            <AdminUserStatus user={user} />
          </button>
        ))}
        {users.length === 0 && <p className="subtle">管理トークンを設定してユーザ一覧を更新してください。</p>}
      </div>
    </section>
  );
}

function AdminUserStatus({ user }: { user: AdminUser }) {
  if (user.disabled_at) return <span className="status-pill danger">停止</span>;
  if (user.suspended_until && new Date(user.suspended_until).getTime() > Date.now()) return <span className="status-pill warning">一時停止</span>;
  return <span className="status-pill ok">有効</span>;
}

function AdminUserDetailModal({
  user,
  recoveryPassword,
  suspendDays,
  message,
  onClose,
  onRecoveryPasswordChange,
  onSuspendDaysChange,
  onResetPassword,
  onUpdateStatus,
}: {
  user: AdminUser;
  recoveryPassword: string;
  suspendDays: number;
  message: string;
  onClose: () => void;
  onRecoveryPasswordChange: (value: string) => void;
  onSuspendDaysChange: (value: number) => void;
  onResetPassword: () => void;
  onUpdateStatus: (action: "suspend" | "disable" | "activate") => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="ユーザ詳細" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-modal-header">
          <div className="panel-heading">
            <UserRound size={18} />
            <span>ユーザ詳細</span>
          </div>
          <button className="icon-button" onClick={onClose} title="閉じる">
            <X size={17} />
          </button>
        </div>
        <div className="admin-user-detail">
          <div className="account-preview">
            <UserAvatar name={user.name} color={user.avatar_color} image={user.avatar_image} large />
            <div>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <dl className="detail-list">
            <div><dt>ユーザID</dt><dd>{user.id}</dd></div>
            <div><dt>ユーザ名</dt><dd>{user.name}</dd></div>
            <div><dt>メールアドレス</dt><dd>{user.email}</dd></div>
            <div><dt>アイコン色</dt><dd>{user.avatar_color}</dd></div>
            <div><dt>作成日</dt><dd>{user.created_at}</dd></div>
            <div><dt>更新日</dt><dd>{user.updated_at}</dd></div>
            <div><dt>セッション数</dt><dd>{user.session_count}</dd></div>
            <div><dt>AIトークン数</dt><dd>{user.api_token_count}</dd></div>
            <div><dt>状態</dt><dd><AdminUserStatus user={user} /></dd></div>
            {user.suspended_until && <div><dt>一時停止期限</dt><dd>{user.suspended_until}</dd></div>}
            {user.disabled_at && <div><dt>停止日時</dt><dd>{user.disabled_at}</dd></div>}
          </dl>
          <div className="settings-subsection">
            <div className="panel-heading compact">
              <KeyRound size={16} />
              <span>アカウント復旧</span>
            </div>
            <label>
              新しいパスワード
              <input type="password" value={recoveryPassword} onChange={(event) => onRecoveryPasswordChange(event.target.value)} />
            </label>
            <button className="text-button danger" onClick={onResetPassword}>
              復旧用パスワードを設定
            </button>
          </div>
          <div className="settings-subsection">
            <div className="panel-heading compact">
              <Clock3 size={16} />
              <span>アカウント状態</span>
            </div>
            <label>
              一時停止日数
              <input type="number" min={1} max={365} value={suspendDays} onChange={(event) => onSuspendDaysChange(Number(event.target.value) || 1)} />
            </label>
            <div className="admin-action-row">
              <button className="text-button" onClick={() => onUpdateStatus("activate")}>再有効化</button>
              <button className="text-button danger" onClick={() => onUpdateStatus("suspend")}>一時停止</button>
              <button className="text-button danger" onClick={() => onUpdateStatus("disable")}>停止</button>
            </div>
          </div>
          {message && <p className="token-message">{message}</p>}
        </div>
      </section>
    </div>
  );
}

function TokenHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="confirm-modal token-help-modal" role="dialog" aria-modal="true" aria-label="AIトークンのヘルプ" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-modal-header">
          <div className="panel-heading">
            <KeyRound size={18} />
            <span>AIトークンの使い方</span>
          </div>
          <button className="icon-button" onClick={onClose} title="閉じる">
            <X size={17} />
          </button>
        </div>
        <p>AIトークンは、あなたが使うコーディングAIにQuick WBSのAPI利用を許可するための認証情報です。</p>
        <ul className="help-list">
          <li>作成したトークンは一度だけ表示されます。</li>
          <li>トークンはあなたのアカウントに紐づき、あなたが見えるタスクだけを扱えます。</li>
          <li>AIには `Authorization: Bearer トークン` として渡します。</li>
          <li>不要になったトークンは失効してください。</li>
          <li>人間のログインパスワードとは別物です。</li>
        </ul>
      </section>
    </div>
  );
}

function TokenPanel({
  tokens,
  newTokenName,
  createdToken,
  message,
  onTokenNameChange,
  onLoad,
  onCreate,
  onRevoke,
  onHelp,
}: {
  tokens: ApiToken[];
  newTokenName: string;
  createdToken: CreatedApiToken | null;
  message: string;
  onTokenNameChange: (value: string) => void;
  onLoad: () => void;
  onCreate: () => void;
  onRevoke: (tokenId: number) => void;
  onHelp: () => void;
}) {
  const activeTokens = tokens.filter((token) => !token.revoked_at);
  const revokedTokens = tokens.filter((token) => token.revoked_at);

  return (
    <section className="token-panel">
      <div className="panel-heading">
        <KeyRound size={18} />
        <span>AIトークン</span>
        <button className="text-button compact" onClick={onHelp}>
          ヘルプ
        </button>
      </div>
      <p className="subtle">このトークンはあなたのアカウントに紐づき、AIがあなたの見えるプロジェクトとタスクだけを操作するために使います。</p>
      <div className="token-actions">
        <button className="text-button" onClick={onLoad}>
          更新
        </button>
      </div>
      <label>
        新しいAI
        <input
          value={newTokenName}
          onChange={(event) => onTokenNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCreate();
          }}
          placeholder="AI名を入力"
        />
      </label>
      <button className="text-button primary" onClick={onCreate}>
        AIトークン作成
      </button>
      {createdToken && (
        <div className="created-token">
          <strong>このトークンは一度だけ表示されます</strong>
          <code>{createdToken.plain_token}</code>
          <button className="icon-button" onClick={() => void navigator.clipboard?.writeText(createdToken.plain_token)} title="トークンをコピー">
            <Copy size={16} />
          </button>
        </div>
      )}
      {message && <p className="token-message">{message}</p>}
      <div className="token-list">
        {activeTokens.map((token) => (
          <div className="token-item" key={token.id}>
            <div>
              <strong>{token.name}</strong>
              <span>{token.last_used_at ? `最終利用 ${token.last_used_at}` : "未使用"}</span>
            </div>
            <button className="text-button danger" onClick={() => onRevoke(token.id)}>
              失効
            </button>
          </div>
        ))}
        {revokedTokens.length > 0 && <p className="subtle">失効済みトークン {revokedTokens.length} 件</p>}
      </div>
    </section>
  );
}

function buildGanttMonthHeaders(days: Date[]): Array<{ key: string; label: string; span: number }> {
  const headers: Array<{ key: string; label: string; span: number }> = [];

  for (const day of days) {
    const key = `${day.getFullYear()}-${day.getMonth()}`;
    const current = headers.at(-1);
    if (current?.key === key) {
      current.span += 1;
    } else {
      headers.push({
        key,
        label: `${day.getFullYear()}年${day.getMonth() + 1}月`,
        span: 1,
      });
    }
  }

  return headers;
}

function drawTextClipped(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number): void {
  let nextText = text;
  while (nextText.length > 0 && context.measureText(nextText).width > maxWidth) {
    nextText = nextText.slice(0, -1);
  }
  context.fillText(nextText.length < text.length ? `${nextText.slice(0, -1)}...` : nextText, x, y);
}

function drawRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function downloadGanttPng(schedule: NonNullable<ReturnType<typeof buildGanttSchedule>>, projectName: string): void {
  const taskWidth = 280;
  const dayWidth = 34;
  const titleHeight = 54;
  const sectionGap = 18;
  const wbsHeaderHeight = 30;
  const wbsRowHeight = 30;
  const wbsHeight = wbsHeaderHeight + schedule.items.length * wbsRowHeight;
  const monthHeight = 30;
  const dayHeight = 32;
  const rowHeight = 38;
  const padding = 22;
  const totalDays = Math.max(1, daysBetween(schedule.start, schedule.end) + 1);
  const chartWidth = taskWidth + totalDays * dayWidth;
  const width = chartWidth + padding * 2;
  const ganttHeight = monthHeight + dayHeight + schedule.items.length * rowHeight;
  const height = titleHeight + wbsHeight + sectionGap + ganttHeight + padding * 2;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;

  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(scale, scale);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  const originX = padding;
  const wbsY = padding + titleHeight;
  const originY = wbsY + wbsHeight + sectionGap;
  const timelineX = originX + taskWidth;
  const title = `${projectName} WBS・ガントチャート`;
  const monthHeaders = buildGanttMonthHeaders(schedule.days);
  const wbsColumns = [
    { label: "WBS", width: 62 },
    { label: "タスク", width: 310 },
    { label: "担当者", width: 120 },
    { label: "状態", width: 88 },
    { label: "期限", width: 90 },
    { label: "進捗", width: 96 },
    { label: "配置", width: 84 },
  ];

  context.fillStyle = "#18202f";
  context.font = '700 20px "Noto Sans JP", "Segoe UI", sans-serif';
  drawTextClipped(context, title, originX, padding + 22, chartWidth - 160);
  context.font = '12px "Noto Sans JP", "Segoe UI", sans-serif';
  context.fillStyle = "#52637a";
  context.fillText(`${formatDateLabel(schedule.start)} - ${formatDateLabel(schedule.end)}`, originX, padding + 40);

  let tableX = originX;
  context.fillStyle = "#f6f8fb";
  context.fillRect(originX, wbsY, chartWidth, wbsHeaderHeight);
  context.strokeStyle = "#dce3ee";
  context.strokeRect(originX, wbsY, chartWidth, wbsHeight);
  for (const column of wbsColumns) {
    context.strokeStyle = "#dce3ee";
    context.strokeRect(tableX, wbsY, column.width, wbsHeaderHeight);
    context.fillStyle = "#52637a";
    context.font = '700 12px "Noto Sans JP", "Segoe UI", sans-serif';
    context.fillText(column.label, tableX + 8, wbsY + 20);
    tableX += column.width;
  }

  schedule.items.forEach((item, rowIndex) => {
    const y = wbsY + wbsHeaderHeight + rowIndex * wbsRowHeight;
    const values = [
      item.wbsNumber,
      item.title,
      item.assigneeName ?? "-",
      statusLabels[item.status],
      item.dueDate ? formatDateLabel(item.dueDate) : "-",
      `${item.progress}%`,
      item.isAutoScheduled ? "自動配置" : "指定",
    ];
    tableX = originX;
    context.fillStyle = rowIndex % 2 === 0 ? "#ffffff" : "#fbfcfe";
    context.fillRect(originX, y, chartWidth, wbsRowHeight);
    values.forEach((value, index) => {
      const column = wbsColumns[index];
      context.strokeStyle = "#eef2f7";
      context.strokeRect(tableX, y, column.width, wbsRowHeight);
      context.fillStyle = index === 1 ? "#26364d" : "#52637a";
      context.font = index === 0 ? '12px "Cascadia Mono", Consolas, monospace' : '12px "Noto Sans JP", "Segoe UI", sans-serif';
      if (column.label === "進捗") {
        context.fillStyle = "#e8eef7";
        drawRoundedRect(context, tableX + 8, y + 7, column.width - 16, 8, 4);
        context.fill();
        context.fillStyle = item.color;
        drawRoundedRect(context, tableX + 8, y + 7, Math.max(0, ((column.width - 16) * item.progress) / 100), 8, 4);
        context.fill();
        context.fillStyle = "#52637a";
        context.font = '11px "Noto Sans JP", "Segoe UI", sans-serif';
        context.fillText(value, tableX + 8, y + 26);
      } else {
        drawTextClipped(context, value, tableX + 8, y + 20, column.width - 16);
      }
      tableX += column.width;
    });
  });

  context.fillStyle = "#f6f8fb";
  context.fillRect(originX, originY, chartWidth, monthHeight + dayHeight);
  context.strokeStyle = "#dce3ee";
  context.strokeRect(originX, originY, chartWidth, monthHeight + dayHeight);
  context.beginPath();
  context.moveTo(timelineX, originY);
  context.lineTo(timelineX, height - padding);
  context.stroke();

  context.fillStyle = "#52637a";
  context.font = '700 13px "Noto Sans JP", "Segoe UI", sans-serif';
  context.fillText("タスク", originX + 10, originY + 39);

  let monthOffset = 0;
  context.textAlign = "center";
  for (const month of monthHeaders) {
    const monthWidth = month.span * dayWidth;
    context.fillStyle = "#26364d";
    context.font = '700 13px "Noto Sans JP", "Segoe UI", sans-serif';
    context.fillText(month.label, timelineX + monthOffset + monthWidth / 2, originY + 20);
    context.strokeStyle = "#dce3ee";
    context.strokeRect(timelineX + monthOffset, originY, monthWidth, monthHeight);
    monthOffset += monthWidth;
  }

  schedule.days.forEach((day, index) => {
    const x = timelineX + index * dayWidth;
    const tone = getDateTone(day);
    context.fillStyle = tone === "holiday" ? "#fff1f0" : tone === "saturday" ? "#eef6ff" : "#f6f8fb";
    context.fillRect(x, originY + monthHeight, dayWidth, dayHeight);
    context.strokeStyle = "#e5ebf3";
    context.strokeRect(x, originY + monthHeight, dayWidth, dayHeight);
    context.fillStyle = tone === "holiday" ? "#c43228" : tone === "saturday" ? "#155eef" : "#52637a";
    context.font = '12px "Noto Sans JP", "Segoe UI", sans-serif';
    context.fillText(formatDateLabel(day), x + dayWidth / 2, originY + monthHeight + 21);
  });
  context.textAlign = "left";

  schedule.items.forEach((item, rowIndex) => {
    const y = originY + monthHeight + dayHeight + rowIndex * rowHeight;
    context.fillStyle = "#ffffff";
    context.fillRect(originX, y, chartWidth, rowHeight);

    schedule.days.forEach((day, index) => {
      const x = timelineX + index * dayWidth;
      const tone = getDateTone(day);
      context.fillStyle = tone === "holiday" ? "#fff6f5" : tone === "saturday" ? "#f3f8ff" : "#ffffff";
      context.fillRect(x, y, dayWidth, rowHeight);
      context.strokeStyle = "#eef2f7";
      context.strokeRect(x, y, dayWidth, rowHeight);
    });

    context.strokeStyle = "#eef2f7";
    context.beginPath();
    context.moveTo(originX, y + rowHeight);
    context.lineTo(originX + chartWidth, y + rowHeight);
    context.stroke();

    context.fillStyle = item.color;
    context.beginPath();
    context.arc(originX + 14 + item.depth * 14, y + rowHeight / 2, 5, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#26364d";
    context.font = '12px "Cascadia Mono", Consolas, monospace';
    context.fillText(item.wbsNumber, originX + 28 + item.depth * 14, y + rowHeight / 2 + 4);
    context.font = '13px "Noto Sans JP", "Segoe UI", sans-serif';
    drawTextClipped(context, item.title, originX + 78 + item.depth * 14, y + rowHeight / 2 + 4, taskWidth - 92 - item.depth * 14);

    const displayStart = item.start < schedule.start ? schedule.start : item.start;
    const displayEnd = item.end > schedule.end ? schedule.end : item.end;
    const offset = daysBetween(schedule.start, displayStart);
    const span = Math.max(1, daysBetween(displayStart, displayEnd) + 1);
    const barX = timelineX + offset * dayWidth + 3;
    const barWidth = span * dayWidth - 6;
    const barY = y + 9;
    drawRoundedRect(context, barX, barY, barWidth, 20, 4);
    context.fillStyle = item.color;
    context.fill();
    drawRoundedRect(context, barX, barY, Math.max(0, (barWidth * item.progress) / 100), 20, 4);
    context.fillStyle = "rgba(255,255,255,0.28)";
    context.fill();
  });

  schedule.days.forEach((day, index) => {
    if (!isToday(day)) return;
    const x = timelineX + index * dayWidth;
    context.fillStyle = "#d92d20";
    context.fillRect(x, originY + monthHeight, 3, ganttHeight - monthHeight);
  });

  const link = document.createElement("a");
  const fileDate = new Date().toISOString().slice(0, 10);
  const safeName = projectName.replace(/[\\/:*?"<>|]/g, "_").trim() || "quick-wbs";
  link.download = `${safeName}-gantt-${fileDate}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function GanttChart({
  schedule,
  projectName,
  onSelectTask,
}: {
  schedule: ReturnType<typeof buildGanttSchedule>;
  projectName: string;
  onSelectTask: (taskId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (!schedule) {
    return (
      <section className="gantt-panel">
        <div className="gantt-header">
          <div className="panel-heading">
            <StretchHorizontal size={18} />
            <span>ガント</span>
          </div>
        </div>
        <p className="subtle">タスクを追加すると自動でガントチャートを生成します。</p>
      </section>
    );
  }

  const totalDays = Math.max(1, daysBetween(schedule.start, schedule.end) + 1);
  const monthHeaders = buildGanttMonthHeaders(schedule.days);
  const today = new Date();
  const dueAlerts: Array<{ item: (typeof schedule.items)[number]; daysLeft: number }> = [];

  return (
    <section className="gantt-panel">
      <div className="gantt-header">
        <div className="panel-heading">
          <StretchHorizontal size={18} />
          <span>ガント</span>
        </div>
        <div className="gantt-actions">
          <button className="text-button" onClick={() => downloadGanttPng(schedule, projectName)}>
            <Download size={16} />
            PNG出力
          </button>
          <button className="text-button" onClick={() => setCollapsed((current) => !current)}>
            {collapsed ? "表示" : "折りたたみ"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          {dueAlerts.length > 0 && (
            <div className="gantt-alerts">
              {dueAlerts.map(({ item, daysLeft }) => (
                <button
                  key={item.id}
                  className={`gantt-alert ${item.dueDate! < today ? "overdue" : "soon"}`}
                  onClick={() => onSelectTask(item.id)}
                >
                  <span className="gantt-color-dot" style={{ backgroundColor: item.color }} />
                  <span className="mono">{item.wbsNumber}</span>
                  <strong>{item.title}</strong>
                  <span>{item.dueDate! < today ? "期限超過" : `あと${daysLeft}日`}</span>
                </button>
              ))}
            </div>
          )}
          <div className="gantt-scroll">
          <div className="gantt-grid" style={{ minWidth: `${280 + totalDays * 34}px` }}>
            <div className="gantt-task-header">タスク</div>
            <div className="gantt-months" style={{ gridTemplateColumns: monthHeaders.map(({ span }) => `${span * 34}px`).join(" ") }}>
              {monthHeaders.map((month) => (
                <div className="gantt-month" key={month.key}>
                  {month.label}
                </div>
              ))}
            </div>
            <div className="gantt-days" style={{ gridTemplateColumns: `repeat(${totalDays}, 34px)` }}>
              {schedule.days.map((day) => {
                const tone = getDateTone(day);
                const holidayName = getJapaneseHolidayName(day);
                return (
                  <div
                    key={day.toISOString()}
                    className={`gantt-day day-${tone} ${isToday(day) ? "is-today" : ""}`}
                    title={holidayName ?? undefined}
                  >
                    {formatDateLabel(day)}
                  </div>
                );
              })}
            </div>
            {schedule.items.map((item) => {
              const displayStart = item.start < schedule.start ? schedule.start : item.start;
              const displayEnd = item.end > schedule.end ? schedule.end : item.end;
              const offset = daysBetween(schedule.start, displayStart);
              const span = Math.max(1, daysBetween(displayStart, displayEnd) + 1);
              return (
                <div className="gantt-row" key={item.id}>
                  <button className="gantt-task-name" onClick={() => onSelectTask(item.id)} style={{ paddingLeft: `${item.depth * 16 + 10}px` }}>
                    <span className="gantt-color-dot" style={{ backgroundColor: item.color }} />
                    <span className="mono">{item.wbsNumber}</span>
                    <span>{item.title}</span>
                    {item.isAutoScheduled && <span className="auto-badge">自動配置</span>}
                  </button>
                  <div className="gantt-timeline" style={{ gridTemplateColumns: `repeat(${totalDays}, 34px)` }}>
                    {schedule.days.map((day, index) => {
                      const tone = getDateTone(day);
                      return (
                        <i
                          key={day.toISOString()}
                          className={`gantt-day-band day-${tone} ${isToday(day) ? "is-today" : ""}`}
                          style={{ gridColumn: `${index + 1} / span 1` }}
                        />
                      );
                    })}
                    <div
                      className="gantt-bar"
                      style={{
                        gridColumn: `${offset + 1} / span ${span}`,
                        backgroundColor: item.color,
                      }}
                      title={`${item.title}: ${formatDateLabel(item.start)} - ${formatDateLabel(item.end)}`}
                    >
                      <span style={{ width: `${item.progress}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        </>
      )}
    </section>
  );
}

function collectDescendantIds(task: TaskNode): string[] {
  return task.children.flatMap((child) => [child.id, ...collectDescendantIds(child)]);
}

function ChildTaskComposer({
  depth,
  value,
  onChange,
  onCancel,
  onSubmit,
}: {
  depth: number;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <tr className="child-composer-row">
      <td className="mono">新規</td>
      <td colSpan={6}>
        <div className="child-composer" style={{ paddingLeft: `${depth * 20 + 8}px` }}>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSubmit();
              if (event.key === "Escape") onCancel();
            }}
            placeholder="子タスク名"
          />
          <button className="text-button primary" onClick={onSubmit}>
            <Plus size={16} />
            追加
          </button>
          <button className="icon-button" onClick={onCancel} title="キャンセル">
            <X size={16} />
          </button>
        </div>
      </td>
      <td></td>
    </tr>
  );
}

function TaskRow({
  task,
  selected,
  collapsed,
  hasChildren,
  onSelect,
  onToggleCollapse,
  onCreateChild,
  onMoveUp,
  onMoveDown,
  onDelete,
  onUpdate,
}: {
  task: TaskNode;
  selected: boolean;
  collapsed: boolean;
  hasChildren: boolean;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onCreateChild: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Task>) => void;
}) {
  const [title, setTitle] = useState(task.title);

  useEffect(() => {
    setTitle(task.title);
  }, [task.title]);

  const saveTitle = () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setTitle(task.title);
      return;
    }
    if (nextTitle !== task.title) {
      void onUpdate({ title: nextTitle });
    }
  };

  return (
    <tr className={selected ? "selected" : ""} onClick={onSelect}>
      <td>
        <div className="wbs-cell">
          {hasChildren ? (
            <button
              className="tree-toggle"
              onClick={(event) => {
                event.stopPropagation();
                onToggleCollapse();
              }}
              title={collapsed ? "展開" : "折りたたみ"}
            >
              {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
            </button>
          ) : (
            <span className="tree-spacer" />
          )}
          <span className="mono">{task.wbsNumber}</span>
        </div>
      </td>
      <td>
        <input
          className="table-input"
          style={{ paddingLeft: `${task.depth * 20 + 8}px` }}
          value={title}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={saveTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setTitle(task.title);
              event.currentTarget.blur();
            }
          }}
        />
      </td>
      <td>
        <select
          value={task.status}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onUpdate({ status: event.target.value as TaskStatus })}
        >
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          value={task.priority}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onUpdate({ priority: event.target.value as TaskPriority })}
        >
          {Object.entries(priorityLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <span className="assignee">
          {task.assignee_type === "ai" ? <Bot size={15} /> : <UserRound size={15} />}
          <span>{task.assignee_name || "-"}</span>
        </span>
      </td>
      <td>{task.due_date || "-"}</td>
      <td>
        <div className="progress">
          <span style={{ width: `${task.progress}%` }} />
        </div>
      </td>
      <td>
        <div className="row-actions">
          <button
            className="icon-button"
            onClick={(event) => {
              event.stopPropagation();
              onMoveUp();
            }}
            title="上へ移動"
          >
            <ArrowUp size={16} />
          </button>
          <button
            className="icon-button"
            onClick={(event) => {
              event.stopPropagation();
              onMoveDown();
            }}
            title="下へ移動"
          >
            <ArrowDown size={16} />
          </button>
          <button
            className="icon-button"
            onClick={(event) => {
              event.stopPropagation();
              onCreateChild();
            }}
            title="子タスク追加"
          >
            <Plus size={16} />
          </button>
          <button
            className="icon-button danger"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            title="タスク削除"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function TaskDetail({
  task,
  logs,
  parentOptions,
  onDelete,
  onUpdate,
}: {
  task: Task;
  logs: TaskLog[];
  parentOptions: TaskNode[];
  onDelete: () => void;
  onUpdate: (patch: Partial<Task>) => void;
}) {
  const [draft, setDraft] = useState({
    title: task.title,
    parent_id: task.parent_id ?? "",
    description: task.description ?? "",
    acceptance_criteria: task.acceptance_criteria ?? "",
    assignee_type: task.assignee_type ?? "",
    assignee_name: task.assignee_name ?? "",
    start_date: task.start_date ?? "",
    due_date: task.due_date ?? "",
    estimate_hours: task.estimate_hours ?? "",
    actual_hours: task.actual_hours ?? "",
    gantt_color: task.gantt_color ?? randomGanttColor(),
    progress: String(task.progress),
  });

  useEffect(() => {
    setDraft({
      title: task.title,
      parent_id: task.parent_id ?? "",
      description: task.description ?? "",
      acceptance_criteria: task.acceptance_criteria ?? "",
      assignee_type: task.assignee_type ?? "",
      assignee_name: task.assignee_name ?? "",
      start_date: task.start_date ?? "",
      due_date: task.due_date ?? "",
      estimate_hours: task.estimate_hours ?? "",
      actual_hours: task.actual_hours ?? "",
      gantt_color: task.gantt_color ?? randomGanttColor(),
      progress: String(task.progress),
    });
  }, [task]);

  const updateDraft = (key: keyof typeof draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const saveText = (key: "title" | "description" | "acceptance_criteria") => {
    const value = draft[key].trim();
    const current = (task[key] ?? "").trim();
    if (key === "title" && !value) {
      updateDraft("title", task.title);
      return;
    }
    if (value !== current) {
      void onUpdate({ [key]: value || null } as Partial<Task>);
    }
  };

  const saveNullable = (key: "assignee_type" | "assignee_name" | "start_date" | "due_date" | "estimate_hours" | "actual_hours") => {
    const value = draft[key].trim();
    if (value !== String(task[key] ?? "")) {
      void onUpdate({ [key]: value || null } as Partial<Task>);
    }
  };

  const saveProgress = () => {
    const value = Math.max(0, Math.min(100, Number(draft.progress || 0)));
    if (value !== Number(task.progress)) {
      void onUpdate({ progress: value });
    }
    updateDraft("progress", String(value));
  };

  const saveGanttColor = (value: string) => {
    updateDraft("gantt_color", value);
    if (value !== task.gantt_color) {
      void onUpdate({ gantt_color: value });
    }
  };

  return (
    <div className="task-detail">
      <label>
        タイトル
        <input
          value={draft.title}
          onChange={(event) => updateDraft("title", event.target.value)}
          onBlur={() => saveText("title")}
        />
      </label>
      <div className="detail-grid">
        {task.parent_id === null && (
          <label>
            <span className="label-with-icon">
              <Palette size={14} />
              ガント色
            </span>
            <div className="color-control">
              <input
                type="color"
                value={draft.gantt_color}
                onInput={(event) => saveGanttColor(event.currentTarget.value)}
                onChange={(event) => saveGanttColor(event.target.value)}
              />
              <span className="color-value">{draft.gantt_color}</span>
            </div>
          </label>
        )}
        <label>
          親タスク
          <select
            value={draft.parent_id}
            onChange={(event) => {
              updateDraft("parent_id", event.target.value);
              void onUpdate({ parent_id: event.target.value || null });
            }}
          >
            <option value="">ルート</option>
            {parentOptions.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {`${parent.wbsNumber} ${parent.title}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          状態
          <select value={task.status} onChange={(event) => onUpdate({ status: event.target.value as TaskStatus })}>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          優先度
          <select value={task.priority} onChange={(event) => onUpdate({ priority: event.target.value as TaskPriority })}>
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          担当種別
          <select
            value={draft.assignee_type}
            onChange={(event) => {
              updateDraft("assignee_type", event.target.value);
              void onUpdate({ assignee_type: event.target.value ? (event.target.value as AssigneeType) : null });
            }}
          >
            <option value="">未設定</option>
            {Object.entries(assigneeTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          担当者
          <input
            value={draft.assignee_name}
            onChange={(event) => updateDraft("assignee_name", event.target.value)}
            onBlur={() => saveNullable("assignee_name")}
          />
        </label>
      </div>
      <label>
        説明
        <textarea value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} onBlur={() => saveText("description")} />
      </label>
      <label>
        受け入れ条件
        <textarea
          value={draft.acceptance_criteria}
          onChange={(event) => updateDraft("acceptance_criteria", event.target.value)}
          onBlur={() => saveText("acceptance_criteria")}
        />
      </label>
      <div className="detail-grid">
        <label>
          <CalendarDays size={16} />
          開始
          <input
            type="date"
            value={draft.start_date}
            onChange={(event) => updateDraft("start_date", event.target.value)}
            onBlur={() => saveNullable("start_date")}
          />
        </label>
        <label>
          <CalendarDays size={16} />
          期限
          <input
            type="date"
            value={draft.due_date}
            onChange={(event) => updateDraft("due_date", event.target.value)}
            onBlur={() => saveNullable("due_date")}
          />
        </label>
        <label>
          <Clock3 size={16} />
          見積
          <input
            type="number"
            min="0"
            value={draft.estimate_hours}
            onChange={(event) => updateDraft("estimate_hours", event.target.value)}
            onBlur={() => saveNullable("estimate_hours")}
          />
        </label>
        <label>
          実績
          <input
            type="number"
            min="0"
            value={draft.actual_hours}
            onChange={(event) => updateDraft("actual_hours", event.target.value)}
            onBlur={() => saveNullable("actual_hours")}
          />
        </label>
        <label>
          <CheckCircle2 size={16} />
          進捗
          <input
            type="number"
            min="0"
            max="100"
            value={draft.progress}
            onChange={(event) => updateDraft("progress", event.target.value)}
            onBlur={saveProgress}
          />
        </label>
      </div>
      <button className="text-button danger" onClick={onDelete}>
        <Trash2 size={17} />
        タスクを削除
      </button>
      <section className="log-list">
        <h2>作業ログ</h2>
        {logs.map((log) => (
          <article key={log.id} className="log-item">
            <strong>{formatLogAction(log.action)}</strong>
            <span>
              {actorTypeLabels[log.actor_type]} / {log.actor_name}
            </span>
            {log.message && <p>{log.message}</p>}
          </article>
        ))}
        {logs.length === 0 && <p className="subtle">まだログはありません。</p>}
      </section>
    </div>
  );
}
