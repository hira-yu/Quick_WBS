# AI Agent Guide

This guide defines the expected workflow for coding AI agents using Quick WBS.

## Core Rules

- Read task context before changing a task.
- Claim a task before starting meaningful work.
- Report progress in small, useful increments.
- Create child tasks when the current task needs clear follow-up work.
- Mark a task complete only when the acceptance criteria are satisfied.
- Use `block` when user input, missing credentials, or external state prevents progress.

## Standard Workflow

1. Identify yourself.

```http
GET /api/agent/me
Authorization: Bearer qwb_xxx
```

2. Find available work.

```http
GET /api/agent/tasks/available
Authorization: Bearer qwb_xxx
```

3. Read the task context.

```http
GET /api/agent/tasks/{task_id}/context
Authorization: Bearer qwb_xxx
```

4. Claim the task.

```http
POST /api/agent/tasks/{task_id}/claim
Authorization: Bearer qwb_xxx
Content-Type: application/json

{
  "message": "Claiming this task for implementation."
}
```

5. Start the task.

```http
POST /api/agent/tasks/{task_id}/start
Authorization: Bearer qwb_xxx
Content-Type: application/json

{
  "progress": 10,
  "message": "Started by reading the existing API and UI structure."
}
```

6. Report progress.

```http
POST /api/agent/tasks/{task_id}/report
Authorization: Bearer qwb_xxx
Content-Type: application/json

{
  "progress": 60,
  "summary": "Implemented the API route and added documentation.",
  "work_notes": "Kept the database schema unchanged and stored structured notes in task logs.",
  "artifacts": [
    "public_html/api/index.php",
    "docs/api.md"
  ],
  "next_actions": [
    "Run PHP lint",
    "Exercise the endpoint with a local API call"
  ]
}
```

7. Create child tasks when needed.

```http
POST /api/agent/tasks/{task_id}/children
Authorization: Bearer qwb_xxx
Content-Type: application/json

{
  "title": "Add token management UI",
  "description": "Allow humans to create and revoke agent tokens from the browser.",
  "priority": "medium",
  "estimate_hours": 4,
  "acceptance_criteria": "Token list, create, and revoke actions are available in the browser UI."
}
```

8. Complete the task.

```http
POST /api/agent/tasks/{task_id}/complete
Authorization: Bearer qwb_xxx
Content-Type: application/json

{
  "message": "Completed implementation and verification.",
  "summary": "All acceptance criteria are satisfied.",
  "artifacts": [
    "public_html/api/index.php",
    "docs/agent-guide.md"
  ]
}
```

## Blocking Work

Use `block` when progress cannot continue without help.

```http
POST /api/agent/tasks/{task_id}/block
Authorization: Bearer qwb_xxx
Content-Type: application/json

{
  "progress": 40,
  "blockers": "Need the production database credentials before validating deployment.",
  "next_actions": [
    "Wait for credentials",
    "Run API token creation test against production"
  ]
}
```

## Reporting Fields

Agent report endpoints accept these optional fields:

- `message`: short human-readable note.
- `summary`: concise status summary.
- `work_notes`: implementation details or reasoning.
- `artifacts`: files, URLs, PRs, or other outputs.
- `next_actions`: recommended follow-up actions.
- `result_url`: a deployed URL, PR URL, or artifact link.
- `blockers`: explanation of what prevents progress.
- `progress`: percentage from 0 to 100.

