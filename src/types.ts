export type TaskStatus = "todo" | "ready" | "in_progress" | "blocked" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type AssigneeType = "human" | "ai";

export type Project = {
  id: string;
  name: string;
  description: string | null;
  group_id: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type User = {
  id: string;
  email: string;
  name: string;
  avatar_color: string;
  avatar_image: string | null;
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

export type ApiToken = {
  id: number;
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
