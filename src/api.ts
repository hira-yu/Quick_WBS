import type { ApiToken, CreatedApiToken, Project, Task, TaskLog } from "./types";

const actorName = "browser";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Actor-Name": actorName,
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message ?? `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export const api = {
  async listProjects(): Promise<Project[]> {
    const payload = await request<{ projects: Project[] }>("/projects");
    return payload.projects;
  },

  async createProject(name: string): Promise<Project> {
    const payload = await request<{ project: Project }>("/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return payload.project;
  },

  async updateProject(projectId: string, patch: Partial<Pick<Project, "name" | "description">>): Promise<Project> {
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

  async listApiTokens(adminToken: string): Promise<ApiToken[]> {
    const payload = await request<{ tokens: ApiToken[] }>("/admin/api-tokens", {
      headers: { "X-Admin-Token": adminToken },
    });
    return payload.tokens;
  },

  async createApiToken(adminToken: string, name: string): Promise<CreatedApiToken> {
    const payload = await request<{ token: CreatedApiToken }>("/admin/api-tokens", {
      method: "POST",
      headers: { "X-Admin-Token": adminToken },
      body: JSON.stringify({ name, scopes: ["agent"] }),
    });
    return payload.token;
  },

  async revokeApiToken(adminToken: string, tokenId: number): Promise<void> {
    await request<{ ok: boolean; revoked: boolean }>(`/admin/api-tokens/${tokenId}`, {
      method: "DELETE",
      headers: { "X-Admin-Token": adminToken },
    });
  },
};
