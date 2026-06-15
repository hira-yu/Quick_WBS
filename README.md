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

Build frontend assets into `public_html`:

```sh
npm run build
```

Create the MySQL tables with `database/schema.sql`.

For the PHP API, copy `public_html/api/config/config.example.php` to `public_html/api/config/config.local.php` and set the database connection values. The local config file is ignored by Git.

## Repository Notes

The detailed implementation plan is maintained locally in `plan.md`, which is intentionally excluded from Git tracking.
