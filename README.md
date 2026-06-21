# Quick WBS

Quick WBS is a web-based Work Breakdown Structure tool for system development task management.

The application is intended for both human users and coding AI agents. Human users manage projects through a browser UI, while AI agents interact with the same task data through an HTTP API.

## Planned Stack

- Frontend: React + TypeScript + Vite
- Backend API: PHP 8
- Database: MySQL
- Hosting: Star Rental Server

## Structure

```txt
database/
  schema.sql
public_html/
  api/
    index.php
    config/
    src/
src/
  React application source
```

## Core Concepts

- Project-based WBS management
- Group sharing
- Guest read-only project sharing
- Hierarchical tasks
- Task status, priority, assignee, due date, estimate, progress, and acceptance criteria
- Work logs for human and AI activity
- AI agent API integration with API token authentication
- JSON and CSV export
- Realtime-like project updates by event polling
- Group members can see project changes from other devices
- Guest read-only pages also auto-refresh

## Development

Install frontend dependencies:

```sh
npm install
```

Start the Vite dev server:

```sh
npm run dev
```

Start the local PHP API server in another terminal:

```sh
npm run dev:api
```

On Windows, the local development environment can also be started with:

```bat
scripts\start-dev.bat
```

This starts XAMPP MySQL, ensures the `quick_wbs` database exists, imports the current schema, starts the PHP API server, and starts Vite.

To stop the PHP API and Vite dev servers:

```bat
scripts\stop-dev.bat
```

Build frontend assets into `public_html`:

```sh
npm run build
```

Create the MySQL tables with `database/schema.sql`.

For the PHP API in production, place the private config outside `public_html` when possible:

```txt
quick_wbs_config/config.local.php
public_html/
  api/
    index.php
```

The API checks `../quick_wbs_config/config.local.php` before falling back to `public_html/api/config/config.local.php` for local development. Set the database connection values and `security.admin_token` in the private config file.

Users create and revoke their own AI API tokens from `設定` -> `AIトークン`. Server administrator operations use `/admin` and the `security.admin_token` value.

Projects can be kept in the personal workspace for solo use, shared with a group, or exposed through a project-specific read-only guest URL. Guest links do not allow task edits, work-log changes, group management, or AI agent operations.

## Getting Started With AI Agents

1. Open `設定 -> AIトークン`.
2. Create a new AI token for the agent you want to use.
3. Copy the connection settings shown after creation.
4. Give the AI tool the API base URL and `Authorization: Bearer <AIトークン>`.
5. Make the AI read `/api/agent/docs` before it starts task work.

AI tokens are different from the administrator token and the normal browser login token.

- AI token: used by Codex or another coding AI for `/api/agent/*`.
- Admin token: used only for administrator operations such as `/admin` and `/api/admin/*`.
- Browser login token: used by the web UI session through `X-User-Token`.

Do not give the admin token or browser login token to an AI tool. If an AI token is exposed, revoke it from the AI token settings screen and create a new one.

## API

See [`docs/api.md`](docs/api.md) for AI agent authentication, token management, and task operation examples.
See [`docs/agent-guide.md`](docs/agent-guide.md) for the recommended coding AI workflow.

## Repository Notes

The detailed implementation plan is maintained locally in `plan.md`, which is intentionally excluded from Git tracking.
