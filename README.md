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
- Hierarchical tasks
- Task status, priority, assignee, due date, estimate, progress, and acceptance criteria
- Work logs for human and AI activity
- API token authentication for AI agents
- JSON and CSV export

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

Projects can be kept in the personal workspace for solo use, or shared later by moving a single project to a group from `設定` -> `グループ`.

## API

See [`docs/api.md`](docs/api.md) for AI agent authentication, token management, and task operation examples.
See [`docs/agent-guide.md`](docs/agent-guide.md) for the recommended coding AI workflow.

## Repository Notes

The detailed implementation plan is maintained locally in `plan.md`, which is intentionally excluded from Git tracking.
