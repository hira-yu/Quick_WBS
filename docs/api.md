# Quick WBS API

Quick WBS exposes JSON APIs for browser users, administrators, and coding AI agents.

## Cache Policy

Every JSON API response includes:

```http
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
Pragma: no-cache
Expires: 0
Last-Modified: <current GMT time>
```

The browser client also uses `fetch(..., { cache: "no-store" })` and appends a timestamp `_` query parameter to every GET request. Successful project and task mutations are followed immediately by a fresh GET instead of waiting for project-event polling.

If a deployment still appears to switch between databases, temporarily enable connection diagnostics:

```php
'debug' => [
    'log_db_connection' => true,
],
```

For each API request, PHP then writes the loaded config path, configured DSN host/database, and actual connected database host/name to `error_log`. Disable this after diagnosis.

## Authentication

Browser user endpoints use the session token returned by registration or login:

```http
X-User-Token: qwu_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

The normal project, task, work-log, and group APIs require this header. Missing, expired, disabled, or otherwise invalid browser sessions return `401 Login required.` Normal APIs are not guest-accessible.

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

Authentication boundaries:

- `/api/projects`, `/api/projects/{id}`, project task routes, `/api/tasks/*`, and `/api/groups/*` require `X-User-Token`.
- `/api/agent/*` including `/api/agent/docs` continues to use `Authorization: Bearer ...`.
- `/api/admin/*` continues to use `X-Admin-Token`.
- `/api/auth/*` and `/api/health` retain their existing authentication behavior.
- `GET /api/guest/projects/{token}` is the only unauthenticated project-reading endpoint.

## Group Management

### Delete Group

```http
DELETE /api/groups/{group_id}
X-User-Token: qwu_xxx
```

Only a `group_members.role = "owner"` user can delete a group. Deletion is a soft delete that sets `user_groups.deleted_at`.

- Non-owner: `403 Group owner required.`
- Missing or already deleted group: `404 Group not found.`
- Active projects remain in the group: `409 Group has active projects. Move or delete projects before deleting the group.`

Move or soft-delete every active project before deleting the group. Membership rows are retained.

## Guest Project Sharing

Guest sharing is configured per project. Project owners and members of the project's group can change the setting under the existing project access rules.

Guest tokens are generated with at least 32 bytes from `random_bytes()` and encoded as a 64-character hexadecimal string.

### Enable or Disable Guest View

```http
PATCH /api/projects/{project_id}/guest-view
X-User-Token: qwu_xxx
Content-Type: application/json

{
  "enabled": true
}
```

Enabling creates a token when one does not exist and updates the guest-view timestamps. Disabling preserves the token but makes the guest endpoint return `404`.

### Rotate Guest URL

```http
POST /api/projects/{project_id}/guest-view/rotate
X-User-Token: qwu_xxx
```

Rotation replaces the token immediately. The previous guest URL then returns `404`. Rotation does not implicitly enable a disabled guest view.

### Read a Shared Project as a Guest

```http
GET /api/guest/projects/{guest_view_token}
```

No login header is required. Access succeeds only when the token matches an active project and `guest_view_enabled = 1`. Every invalid, disabled, rotated, deleted, or unknown token returns `404` so project existence is not disclosed.

The response contains only:

- Project: `id`, `name`, `description`, `created_by`, `created_at`, `updated_at`
- Tasks: WBS hierarchy, display fields, dates, estimates, progress, acceptance criteria, order, gantt color, and timestamps

It does not contain email addresses, API tokens, sessions, administrator data, internal permissions, or `deleted_at`.

Guest access is read-only. It cannot create, update, move, or delete tasks; add work logs; manage groups; delete projects; or call any `/agent/*` action.

The browser-facing guest page is `/guest/projects/{guest_view_token}` and renders the WBS, gantt chart, and read-only task details without requiring login.

## Project Update Events

Quick WBS records successful project and task changes in `project_events`. The event feed lets another browser detect a change without repeatedly downloading every task when nothing has changed.

This initial realtime-like implementation uses lightweight HTTP polling instead of WebSocket connections. The browser checks about every three seconds, pauses while the page is hidden, and backs off after consecutive errors. This design prioritizes compatibility with PHP hosting environments such as Star Rental Server.

While an input, textarea, select, or task editor has unsaved changes, polling is reduced to about 12 seconds and external events are deferred. Deferred changes are applied after focus leaves the form; successful local mutations still perform their immediate GET refresh. Realtime status state changes only when the displayed status actually changes.

Recorded event types include:

- `project.updated`
- `task.created`
- `task.updated`
- `task.deleted`
- `task.moved`
- `task.log.created`
- `guest_view.updated`
- `guest_view.rotated`

### Read Project Events

```http
GET /api/projects/{project_id}/events
GET /api/projects/{project_id}/events?since={event_id}
X-User-Token: qwu_xxx
```

The endpoint requires normal project read access. Without `since`, it returns an empty `events` array and the current `latest_event_id`. With `since`, it returns at most 100 events whose IDs are greater than the supplied ID.

```json
{
  "events": [
    {
      "id": 124,
      "project_id": "project_xxx",
      "actor_user_id": "user_xxx",
      "event_type": "task.updated",
      "target_type": "task",
      "target_id": "task_xxx",
      "summary": "タスクが更新されました",
      "payload": {
        "fields": ["progress"]
      },
      "created_at": "2026-06-20 21:30:00"
    }
  ],
  "latest_event_id": 124
}
```

### Read Guest Project Events

```http
GET /api/guest/projects/{guest_view_token}/events
GET /api/guest/projects/{guest_view_token}/events?since={event_id}
```

This endpoint is available only while guest viewing is enabled. Invalid, rotated, disabled, deleted, or unknown tokens return `404`. Guest event responses omit `actor_user_id` and `payload`.

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

Use the returned token only for Quick WBS AI agent operations. The intended header format is:

```http
Authorization: Bearer qwb_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

The token body is shown only once immediately after creation and cannot be fetched again later.

### Revoke My API Token

```http
DELETE /api/auth/api-tokens/1
X-User-Token: qwu_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Revoke the token immediately if it is no longer needed or may have been exposed.

### Token Differences

- AI token: for coding AI access to `/api/agent/*`.
- Admin token: for system administration and `/api/admin/*`.
- Browser login token: for the web UI session through `X-User-Token`.

Do not pass admin tokens or browser login tokens to AI tools.

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

Returns the token name together with the owner user information and the display label used in task assignments and logs.

### Read Agent Docs

```http
GET /api/agent/docs
Authorization: Bearer qwb_xxx
```

Returns the current agent identity plus the bundled Quick WBS documentation that an AI client needs to operate safely.

This is the recommended first request for any new AI integration because it returns both the current identity and the latest built-in operating docs.

```json
{
  "agent": {
    "id": 12,
    "name": "codex-agent",
    "owner_user_id": "user_xxx",
    "owner_name": "Yamada",
    "actor_label": "Yamada のAI (codex-agent)",
    "scopes": ["agent"],
    "last_used_at": "2026-06-21 10:30:00"
  },
  "documents": [
    {
      "id": "api",
      "title": "Quick WBS API",
      "path": "docs/api.md",
      "content": "# Quick WBS API\n..."
    },
    {
      "id": "agent-guide",
      "title": "AI Agent Guide",
      "path": "docs/agent-guide.md",
      "content": "# AI Agent Guide\n..."
    }
  ]
}
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

AI-created assignments and task logs use the agent display label, for example `Yamada のAI (codex-agent)`, so human users can tell whose AI made the change.
