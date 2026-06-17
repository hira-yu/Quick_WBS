# Quick WBS API

Quick WBS exposes JSON APIs for browser users, administrators, and coding AI agents.

## Authentication

AI agent endpoints use bearer tokens:

```http
Authorization: Bearer qwb_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
X-Actor-Name: coding-agent
```

Admin token endpoints use:

```http
X-Admin-Token: your-admin-token
```

For production, preconfigure the admin token outside `public_html` when possible. The API first looks for `quick_wbs_config/config.local.php` next to `public_html`, then falls back to `public_html/api/config/config.local.php` for local development.

Example:

```php
'security' => [
    'require_agent_token' => true,
    'admin_token' => 'your-admin-token',
],
```

Users create their own AI tokens from `設定` -> `AIトークン`. Those tokens are tied to the user account and can only access projects and tasks the user can see.

Browser setup endpoints:

```http
GET /api/admin/setup
POST /api/admin/setup
Content-Type: application/json

{
  "admin_token": "your-admin-token"
}
```

## User AI Token Management

### List My API Tokens

```http
GET /api/auth/api-tokens
X-User-Token: qwu_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Create My API Token

```http
POST /api/auth/api-tokens
X-User-Token: qwu_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "name": "codex-agent",
  "scopes": ["agent"]
}
```

### Revoke My API Token

```http
DELETE /api/auth/api-tokens/1
X-User-Token: qwu_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Admin Token Management

### List API Tokens

```http
GET /api/admin/api-tokens
X-Admin-Token: your-admin-token
```

### Create API Token

```http
POST /api/admin/api-tokens
X-Admin-Token: your-admin-token
Content-Type: application/json

{
  "name": "codex-agent",
  "scopes": ["agent"]
}
```

The response includes `plain_token` only once. Store it immediately.

### Revoke API Token

```http
DELETE /api/admin/api-tokens/{id}
X-Admin-Token: your-admin-token
```

## Agent Endpoints

### Check Current Agent

```http
GET /api/agent/me
Authorization: Bearer qwb_xxx
```

### List Available Tasks

Returns unclaimed or AI-assigned tasks in `todo` or `ready` status.

```http
GET /api/agent/tasks/available
Authorization: Bearer qwb_xxx
```

### Get Task Context

Returns the task, project info, ancestor tasks, child tasks, and recent logs.

```http
GET /api/agent/tasks/{task_id}/context
Authorization: Bearer qwb_xxx
```

### Update Agent Task State

```http
POST /api/agent/tasks/{task_id}/claim
POST /api/agent/tasks/{task_id}/start
POST /api/agent/tasks/{task_id}/block
POST /api/agent/tasks/{task_id}/complete
POST /api/agent/tasks/{task_id}/report
Authorization: Bearer qwb_xxx
Content-Type: application/json

{
  "progress": 60,
  "message": "Implemented the API client and added tests.",
  "summary": "The endpoint now returns task context for coding agents.",
  "work_notes": "Kept changes limited to PHP API routing and docs.",
  "artifacts": ["docs/api.md", "public_html/api/index.php"],
  "next_actions": ["Add UI for token management"],
  "result_url": "https://github.com/example/repo/pull/123"
}
```

Actions:

- `claim`: assign the task to the AI and mark it ready.
- `start`: assign the task to the AI and mark it in progress.
- `block`: assign the task to the AI and mark it blocked.
- `complete`: assign the task to the AI, mark it done, and set progress to 100.
- `report`: add a structured log message. If `progress` is supplied, progress is increased without changing status.

### Create Child Task

AI agents can split work into child tasks under the current task.

```http
POST /api/agent/tasks/{task_id}/children
Authorization: Bearer qwb_xxx
Content-Type: application/json

{
  "title": "Add API token management UI",
  "description": "Create a minimal screen for listing, creating, and revoking agent tokens.",
  "priority": "medium",
  "estimate_hours": 4,
  "acceptance_criteria": "A human user can create a token and revoke it from the browser."
}
```

The created child task is assigned to the calling AI agent.
