# HTTP Integration Tests

The reusable integration test is:

```powershell
C:\php\php.exe scripts\http-integration-test.php `
  http://127.0.0.1:8081/api `
  http://127.0.0.1:8081
```

It creates uniquely named users, groups, projects, and tasks, then verifies:

1. Normal project, task, group, and work-log APIs return `401` without `X-User-Token`.
2. An authenticated owner can create, read, update, and soft-delete personal projects and tasks.
3. A group member can list, read, and update a shared project and its tasks.
4. An enabled guest token can read the limited guest project response without login.
5. A guest token cannot update or delete tasks, create work logs, or call agent actions.
6. Disabling guest view makes the shared API URL return `404`.
7. Rotating the token makes the old URL return `404` and the new URL return `200`.
8. A non-owner receives `403` when deleting a group; the owner can delete it.
9. A group with an active project returns `409` on deletion.
10. Deleted groups are absent from group lists and fail membership and project-creation checks.
11. Direct navigation to `/guest/projects/{token}` returns the React entry document.
12. Project event feeds return task create, update, and delete events after the requested event ID.
13. Users without project access cannot read its event feed.
14. Guest event feeds work only while guest viewing is enabled and omit private event fields.

## Multi-browser realtime check

1. Open the same shared project in browser A and browser B using two group member accounts.
2. In browser A, add a task.
3. Confirm the task appears in browser B within about five seconds without reloading.
4. In browser A, edit the task title or progress.
5. Confirm the WBS and gantt chart update in browser B within about five seconds.
6. Start editing a different task field in browser B, then update that task in browser A.
7. Confirm browser B shows the external-update warning and preserves its unsaved input.
8. Enable guest viewing and open the guest URL in another browser or private window.
9. Update a task from the logged-in browser.
10. Confirm the guest WBS and gantt chart update within about five seconds and still have no editing controls.
11. Disable guest viewing and confirm the guest page stops loading the project.
12. Hide a tab, make a change elsewhere, then return to the tab and confirm it refreshes.

## Isolated database setup

Use a dedicated database. Do not run the test against production data.

```powershell
C:\xampp\mysql\bin\mysql.exe -uroot -e `
  "DROP DATABASE IF EXISTS quick_wbs_http_test; CREATE DATABASE quick_wbs_http_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

Get-Content database\schema.sql |
  C:\xampp\mysql\bin\mysql.exe -uroot quick_wbs_http_test
```

Temporarily configure `public_html/api/config/config.local.php`:

```php
<?php

return [
    'db' => [
        'dsn' => 'mysql:host=127.0.0.1;dbname=quick_wbs_http_test;charset=utf8mb4',
        'user' => 'root',
        'password' => '',
    ],
    'security' => [
        'require_agent_token' => true,
    ],
];
```

Start the API and static frontend:

```powershell
C:\php\php.exe -S 127.0.0.1:8081 -t public_html public_html/dev-router.php
```

Run the integration test in another terminal. Restore the normal local database configuration afterward.

## Production-style rewrite check

`public_html/.htaccess` must route API requests before the SPA fallback:

```apache
RewriteRule ^api(?:/.*)?$ api/index.php [L,QSA]
```

The remaining fallback sends non-file, non-directory browser routes such as `/guest/projects/{token}` to `index.html`.

After deploying under Apache with `mod_rewrite` and `AllowOverride FileInfo` or `AllowOverride All`, verify:

```powershell
curl.exe -i http://your-host/api/health
curl.exe -i http://your-host/guest/projects/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

Expected results:

- `/api/health`: `200` with JSON.
- `/guest/projects/{64-character-token}`: `200` with the React `index.html`; React then calls the guest API and displays either the shared project or the invalid-link state.

## Last local result

On June 20, 2026, the complete local test suite finished with `13 checks, 0 failures` against the PHP development API and Vite frontend. The production-style Apache rewrite checks remain covered by `public_html/.htaccess`.
