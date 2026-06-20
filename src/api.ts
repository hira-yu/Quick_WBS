import type { AdminUser, ApiToken, AuthSession, CreatedApiToken, Group, GroupMember, GuestProject, Project, ProjectEventResponse, Task, TaskLog, User } from "./types";

const actorName = "browser";
let userToken = localStorage.getItem("quick-wbs-user-token") ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function setApiUserToken(token: string): void {
  userToken = token;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Actor-Name": actorName,
      ...(userToken ? { "X-User-Token": userToken } : {}),
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message ?? `Request failed: ${response.status}`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export const api = {
  async register(name: string, email: string, password: string): Promise<AuthSession> {
    return request<AuthSession>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
  },

  async login(email: string, password: string): Promise<AuthSession> {
    return request<AuthSession>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  async logout(): Promise<void> {
    await request<{ ok: boolean }>("/auth/logout", { method: "POST" });
  },

  async me(): Promise<{ user: User; groups: Group[] }> {
    return request<{ user: User; groups: Group[] }>("/auth/me");
  },

  async updateMe(patch: Partial<Pick<User, "name" | "avatar_color" | "avatar_image">>): Promise<User> {
    const payload = await request<{ user: User }>("/auth/me", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return payload.user;
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await request<{ ok: boolean }>("/auth/password", {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  },

  async listGroups(): Promise<Group[]> {
    const payload = await request<{ groups: Group[] }>("/groups");
    return payload.groups;
  },

  async createGroup(name: string): Promise<Group> {
    const payload = await request<{ group: Group }>("/groups", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return payload.group;
  },

  async listGroupMembers(groupId: string): Promise<GroupMember[]> {
    const payload = await request<{ members: GroupMember[] }>(`/groups/${groupId}/members`);
    return payload.members;
  },

  async addGroupMember(groupId: string, identifier: string): Promise<GroupMember[]> {
    const payload = await request<{ members: GroupMember[] }>(`/groups/${groupId}/members`, {
      method: "POST",
      body: JSON.stringify({ identifier }),
    });
    return payload.members;
  },

  async removeGroupMember(groupId: string, userId: string): Promise<void> {
    await request<{ ok: boolean }>(`/groups/${groupId}/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
  },

  async deleteGroup(groupId: string): Promise<void> {
    await request<{ ok: boolean }>(`/groups/${groupId}`, { method: "DELETE" });
  },

  async listProjects(groupId?: string): Promise<Project[]> {
    const query = groupId ? `?group_id=${encodeURIComponent(groupId)}` : "";
    const payload = await request<{ projects: Project[] }>(`/projects${query}`);
    return payload.projects;
  },

  async createProject(name: string, groupId?: string): Promise<Project> {
    const payload = await request<{ project: Project }>("/projects", {
      method: "POST",
      body: JSON.stringify({ name, group_id: groupId || null }),
    });
    return payload.project;
  },

  async updateProject(projectId: string, patch: Partial<Pick<Project, "name" | "description" | "group_id">>): Promise<Project> {
    const payload = await request<{ project: Project }>(`/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return payload.project;
  },

  async deleteProject(projectId: string): Promise<void> {
    await request<{ ok: boolean }>(`/projects/${projectId}`, {
      method: "DELETE",
    });
  },

  async getProject(projectId: string): Promise<Project> {
    const payload = await request<{ project: Project }>(`/projects/${projectId}`);
    return payload.project;
  },

  async listProjectEvents(projectId: string, since?: number): Promise<ProjectEventResponse> {
    const query = since === undefined ? "" : `?since=${encodeURIComponent(String(since))}`;
    return request<ProjectEventResponse>(`/projects/${projectId}/events${query}`);
  },

  async updateProjectGuestView(projectId: string, enabled: boolean): Promise<Project> {
    const payload = await request<{ project: Project }>(`/projects/${projectId}/guest-view`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
    return payload.project;
  },

  async rotateProjectGuestView(projectId: string): Promise<Project> {
    const payload = await request<{ project: Project }>(`/projects/${projectId}/guest-view/rotate`, {
      method: "POST",
    });
    return payload.project;
  },

  async getGuestProject(token: string): Promise<{ project: GuestProject; tasks: Task[] }> {
    const payload = await request<{
      project: GuestProject;
      tasks: Array<{
        id: string;
        project_id: string;
        parent_id: string | null;
        title: string;
        description: string | null;
        status: Task["status"];
        priority: Task["priority"];
        assignee: { type: Task["assignee_type"]; name: string } | null;
        start_date: string | null;
        due_date: string | null;
        estimated_hours: string | null;
        actual_hours: string | null;
        progress: number;
        acceptance_criteria: string | null;
        order_index: number;
        gantt_color: string | null;
        created_at: string;
        updated_at: string;
      }>;
    }>(`/guest/projects/${encodeURIComponent(token)}`);

    return {
      project: payload.project,
      tasks: payload.tasks.map((task) => ({
        id: task.id,
        project_id: task.project_id,
        parent_id: task.parent_id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assignee_type: task.assignee?.type ?? null,
        assignee_name: task.assignee?.name ?? null,
        acceptance_criteria: task.acceptance_criteria,
        start_date: task.start_date,
        due_date: task.due_date,
        estimate_hours: task.estimated_hours,
        actual_hours: task.actual_hours,
        gantt_color: task.gantt_color,
        progress: task.progress,
        sort_order: task.order_index,
        created_by: "",
        updated_by: "",
        created_at: task.created_at,
        updated_at: task.updated_at,
      })),
    };
  },

  async listGuestProjectEvents(token: string, since?: number): Promise<ProjectEventResponse> {
    const query = since === undefined ? "" : `?since=${encodeURIComponent(String(since))}`;
    return request<ProjectEventResponse>(`/guest/projects/${encodeURIComponent(token)}/events${query}`);
  },

  async listTasks(projectId: string): Promise<Task[]> {
    const payload = await request<{ tasks: Task[] }>(`/projects/${projectId}/tasks`);
    return payload.tasks;
  },

  async createTask(projectId: string, title: string, parentId?: string, fields: Partial<Task> = {}): Promise<Task> {
    const path = parentId ? `/tasks/${parentId}/children` : `/projects/${projectId}/tasks`;
    const payload = await request<{ task: Task }>(path, {
      method: "POST",
      body: JSON.stringify({ ...fields, title }),
    });
    return payload.task;
  },

  async updateTask(taskId: string, patch: Partial<Task>): Promise<Task> {
    const payload = await request<{ task: Task }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return payload.task;
  },

  async moveTask(taskId: string, direction: "up" | "down"): Promise<Task[]> {
    const payload = await request<{ tasks: Task[] }>(`/tasks/${taskId}/move`, {
      method: "POST",
      body: JSON.stringify({ direction }),
    });
    return payload.tasks;
  },

  async deleteTask(taskId: string): Promise<void> {
    await request<{ ok: boolean }>(`/tasks/${taskId}`, {
      method: "DELETE",
    });
  },

  async listTaskLogs(taskId: string): Promise<TaskLog[]> {
    const payload = await request<{ logs: TaskLog[] }>(`/tasks/${taskId}/logs`);
    return payload.logs;
  },

  async getAdminSetup(): Promise<{ configured: boolean; config_file_enabled: boolean }> {
    return request<{ configured: boolean; config_file_enabled: boolean }>("/admin/setup");
  },

  async setupAdminToken(adminToken: string): Promise<{ configured: boolean }> {
    return request<{ configured: boolean }>("/admin/setup", {
      method: "POST",
      body: JSON.stringify({ admin_token: adminToken }),
    });
  },

  async listAdminApiTokens(adminToken: string): Promise<ApiToken[]> {
    const payload = await request<{ tokens: ApiToken[] }>("/admin/api-tokens", {
      headers: { "X-Admin-Token": adminToken },
    });
    return payload.tokens;
  },

  async listApiTokens(): Promise<ApiToken[]> {
    const payload = await request<{ tokens: ApiToken[] }>("/auth/api-tokens");
    return payload.tokens;
  },

  async createApiToken(name: string): Promise<CreatedApiToken> {
    const payload = await request<{ token: CreatedApiToken }>("/auth/api-tokens", {
      method: "POST",
      body: JSON.stringify({ name, scopes: ["agent"] }),
    });
    return payload.token;
  },

  async revokeApiToken(tokenId: number): Promise<void> {
    await request<{ ok: boolean; revoked: boolean }>(`/auth/api-tokens/${tokenId}`, {
      method: "DELETE",
    });
  },

  async resetUserPassword(adminToken: string, identifier: string, newPassword: string): Promise<void> {
    await request<{ ok: boolean }>("/admin/users/password", {
      method: "POST",
      headers: { "X-Admin-Token": adminToken },
      body: JSON.stringify({ identifier, new_password: newPassword }),
    });
  },

  async listAdminUsers(adminToken: string): Promise<AdminUser[]> {
    const payload = await request<{ users: AdminUser[] }>("/admin/users", {
      headers: { "X-Admin-Token": adminToken },
    });
    return payload.users;
  },

  async getAdminUser(adminToken: string, userId: string): Promise<AdminUser> {
    const payload = await request<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(userId)}`, {
      headers: { "X-Admin-Token": adminToken },
    });
    return payload.user;
  },

  async resetAdminUserPassword(adminToken: string, userId: string, newPassword: string): Promise<void> {
    await request<{ ok: boolean }>(`/admin/users/${encodeURIComponent(userId)}/password`, {
      method: "POST",
      headers: { "X-Admin-Token": adminToken },
      body: JSON.stringify({ new_password: newPassword }),
    });
  },

  async updateAdminUserStatus(adminToken: string, userId: string, action: "suspend" | "disable" | "activate", days?: number): Promise<AdminUser> {
    const payload = await request<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "X-Admin-Token": adminToken },
      body: JSON.stringify({ action, days }),
    });
    return payload.user;
  },
};
