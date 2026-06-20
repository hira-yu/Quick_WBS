export type TaskStatus = "todo" | "ready" | "in_progress" | "blocked" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type AssigneeType = "human" | "ai";

export type Project = {
  id: string;
  name: string;
  description: string | null;
  group_id: string | null;
  owner_user_id: string | null;
  guest_view_enabled: boolean | number | "0" | "1";
  guest_view_token: string | null;
  guest_view_created_at: string | null;
  guest_view_updated_at: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type GuestProject = Pick<Project, "id" | "name" | "description" | "created_by" | "created_at" | "updated_at">;

export type User = {
  id: string;
  email: string;
  name: string;
  avatar_color: string;
  avatar_image: string | null;
};

export type AdminUser = User & {
  created_at: string;
  updated_at: string;
  suspended_until: string | null;
  disabled_at: string | null;
  deleted_at: string | null;
  session_count: number;
  api_token_count: number;
};

export type Group = {
  id: string;
  name: string;
  role: "owner" | "member";
  created_at: string;
  updated_at: string;
};

export type GroupMember = {
  user_id: string;
  email: string;
  name: string;
  avatar_color: string;
  avatar_image: string | null;
  role: "owner" | "member";
  created_at: string;
};

export type AuthSession = {
  user: User;
  token: string;
  groups: Group[];
};

export type Task = {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_type: AssigneeType | null;
  assignee_name: string | null;
  acceptance_criteria: string | null;
  start_date: string | null;
  due_date: string | null;
  estimate_hours: string | null;
  actual_hours: string | null;
  gantt_color: string | null;
  progress: number;
  sort_order: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type TaskLog = {
  id: number;
  task_id: string;
  actor_type: "human" | "ai" | "system";
  actor_name: string;
  action: string;
  message: string | null;
  created_at: string;
};

export type ProjectEvent = {
  id: number;
  project_id: string;
  actor_user_id?: string | null;
  event_type: string;
  target_type: string;
  target_id: string | null;
  summary: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
};

export type ProjectEventResponse = {
  events: ProjectEvent[];
  latest_event_id: number;
};

export type ApiToken = {
  id: number;
  user_id?: string | null;
  name: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type CreatedApiToken = {
  id: number;
  name: string;
  scopes: string[];
  plain_token: string;
};

export type TaskNode = Task & {
  wbsNumber: string;
  depth: number;
  children: TaskNode[];
};
