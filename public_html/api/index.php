<?php

declare(strict_types=1);

require_once __DIR__ . '/src/Response.php';
require_once __DIR__ . '/src/Request.php';
require_once __DIR__ . '/src/Database.php';
require_once __DIR__ . '/src/Validation.php';
require_once __DIR__ . '/src/TaskLog.php';
require_once __DIR__ . '/src/Auth.php';
require_once __DIR__ . '/src/Support.php';

$configCandidates = [
    dirname(__DIR__, 2) . '/quick_wbs_config/config.local.php',
    __DIR__ . '/config/config.local.php',
    __DIR__ . '/config/config.example.php',
];

$configPath = null;
foreach ($configCandidates as $candidate) {
    if (file_exists($candidate)) {
        $configPath = $candidate;
        break;
    }
}

if ($configPath === null) {
    Response::error('Configuration file not found.', 500);
}

$config = require $configPath;
$request = new Request();

try {
    $pdo = Database::connect($config);
    ensureSchema($pdo);
    route($pdo, $request, $config);
} catch (Throwable $error) {
    Response::error('Internal server error.', 500, [
        'type' => $error::class,
        'message' => $error->getMessage(),
    ]);
}

function ensureSchema(PDO $pdo): void
{
    $stmt = $pdo->query("SHOW COLUMNS FROM tasks LIKE 'gantt_color'");
    if (!$stmt->fetch()) {
        $pdo->exec('ALTER TABLE tasks ADD COLUMN gantt_color CHAR(7) NULL AFTER actual_hours');
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS app_settings (
            setting_key VARCHAR(64) PRIMARY KEY,
            setting_value TEXT NOT NULL,
            updated_at DATETIME NOT NULL
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(32) PRIMARY KEY,
            email VARCHAR(255) NOT NULL UNIQUE,
            name VARCHAR(255) NOT NULL,
            avatar_color CHAR(7) NOT NULL DEFAULT \'#155eef\',
            avatar_image TEXT NULL,
            password_hash VARCHAR(255) NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            suspended_until DATETIME NULL,
            disabled_at DATETIME NULL,
            deleted_at DATETIME NULL
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );

    $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'avatar_color'");
    if (!$stmt->fetch()) {
        $pdo->exec('ALTER TABLE users ADD COLUMN avatar_color CHAR(7) NOT NULL DEFAULT \'#155eef\' AFTER name');
    }

    $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'avatar_image'");
    if (!$stmt->fetch()) {
        $pdo->exec('ALTER TABLE users ADD COLUMN avatar_image TEXT NULL AFTER avatar_color');
    }

    $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'suspended_until'");
    if (!$stmt->fetch()) {
        $pdo->exec('ALTER TABLE users ADD COLUMN suspended_until DATETIME NULL AFTER updated_at');
    }

    $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'disabled_at'");
    if (!$stmt->fetch()) {
        $pdo->exec('ALTER TABLE users ADD COLUMN disabled_at DATETIME NULL AFTER suspended_until');
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS user_groups (
            id VARCHAR(32) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            created_by VARCHAR(32) NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            deleted_at DATETIME NULL,
            INDEX idx_user_groups_created_by (created_by)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS group_members (
            group_id VARCHAR(32) NOT NULL,
            user_id VARCHAR(32) NOT NULL,
            role ENUM("owner", "member") NOT NULL DEFAULT "member",
            created_at DATETIME NOT NULL,
            PRIMARY KEY (group_id, user_id),
            INDEX idx_group_members_user (user_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS user_sessions (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(32) NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            created_at DATETIME NOT NULL,
            last_used_at DATETIME NULL,
            expires_at DATETIME NOT NULL,
            INDEX idx_user_sessions_user (user_id),
            INDEX idx_user_sessions_expires (expires_at)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS api_tokens (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(32) NULL,
            name VARCHAR(255) NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            scopes JSON NULL,
            created_at DATETIME NOT NULL,
            last_used_at DATETIME NULL,
            revoked_at DATETIME NULL,
            INDEX idx_api_tokens_user (user_id),
            INDEX idx_api_tokens_created (created_at)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );

    $stmt = $pdo->query("SHOW COLUMNS FROM api_tokens LIKE 'user_id'");
    if (!$stmt->fetch()) {
        $pdo->exec('ALTER TABLE api_tokens ADD COLUMN user_id VARCHAR(32) NULL AFTER id');
        $pdo->exec('CREATE INDEX idx_api_tokens_user ON api_tokens(user_id)');
    }

    $stmt = $pdo->query("SHOW COLUMNS FROM projects LIKE 'group_id'");
    if (!$stmt->fetch()) {
        $pdo->exec('ALTER TABLE projects ADD COLUMN group_id VARCHAR(32) NULL AFTER description');
        $pdo->exec('CREATE INDEX idx_projects_group_updated ON projects(group_id, updated_at)');
    }

    $stmt = $pdo->query("SHOW COLUMNS FROM projects LIKE 'owner_user_id'");
    if (!$stmt->fetch()) {
        $pdo->exec('ALTER TABLE projects ADD COLUMN owner_user_id VARCHAR(32) NULL AFTER group_id');
        $pdo->exec('CREATE INDEX idx_projects_owner_updated ON projects(owner_user_id, updated_at)');
    }

    $projectColumns = [
        'guest_view_enabled' => 'ALTER TABLE projects ADD COLUMN guest_view_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER owner_user_id',
        'guest_view_token' => 'ALTER TABLE projects ADD COLUMN guest_view_token VARCHAR(64) NULL AFTER guest_view_enabled',
        'guest_view_created_at' => 'ALTER TABLE projects ADD COLUMN guest_view_created_at DATETIME NULL AFTER guest_view_token',
        'guest_view_updated_at' => 'ALTER TABLE projects ADD COLUMN guest_view_updated_at DATETIME NULL AFTER guest_view_created_at',
    ];
    foreach ($projectColumns as $column => $sql) {
        $stmt = $pdo->query("SHOW COLUMNS FROM projects LIKE " . $pdo->quote($column));
        if (!$stmt->fetch()) {
            $pdo->exec($sql);
        }
    }

    $stmt = $pdo->query("SHOW INDEX FROM projects WHERE Key_name = 'uq_projects_guest_view_token'");
    if (!$stmt->fetch()) {
        $pdo->exec('CREATE UNIQUE INDEX uq_projects_guest_view_token ON projects(guest_view_token)');
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS project_events (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            project_id VARCHAR(32) NOT NULL,
            actor_user_id VARCHAR(32) NULL,
            event_type VARCHAR(64) NOT NULL,
            target_type VARCHAR(64) NOT NULL,
            target_id VARCHAR(64) NULL,
            summary VARCHAR(255) NULL,
            payload JSON NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_project_events_project_id (project_id, id),
            INDEX idx_project_events_created_at (created_at)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );

    foreach ([
        'idx_project_events_project_id' => 'CREATE INDEX idx_project_events_project_id ON project_events(project_id, id)',
        'idx_project_events_created_at' => 'CREATE INDEX idx_project_events_created_at ON project_events(created_at)',
    ] as $indexName => $sql) {
        $stmt = $pdo->query('SHOW INDEX FROM project_events WHERE Key_name = ' . $pdo->quote($indexName));
        if (!$stmt->fetch()) {
            $pdo->exec($sql);
        }
    }

    $pdo->exec(
        'UPDATE projects
         INNER JOIN group_members ON group_members.group_id = projects.group_id AND group_members.role = "owner"
         SET projects.owner_user_id = group_members.user_id
         WHERE projects.owner_user_id IS NULL',
    );
    $pdo->exec(
        'UPDATE projects
         INNER JOIN users ON users.name = projects.created_by OR users.email = projects.created_by
         SET projects.owner_user_id = users.id
         WHERE projects.owner_user_id IS NULL',
    );
}

function route(PDO $pdo, Request $request, array $config): void
{
    $method = $request->method;
    $path = $request->path;

    if ($method === 'OPTIONS') {
        Response::json(['ok' => true]);
        return;
    }

    if ($method === 'GET' && $path === '/health') {
        Response::json(['ok' => true, 'service' => 'quick-wbs-api']);
        return;
    }

    if ($method === 'GET' && preg_match('#^/guest/projects/([A-Fa-f0-9]{64})/events$#', $path, $m)) {
        listGuestProjectEvents($pdo, strtolower($m[1]));
        return;
    }

    if ($method === 'GET' && preg_match('#^/guest/projects/([A-Fa-f0-9]{64})$#', $path, $m)) {
        getGuestProject($pdo, strtolower($m[1]));
        return;
    }

    if ($method === 'POST' && $path === '/auth/register') {
        registerUser($pdo, $request);
        return;
    }

    if ($method === 'POST' && $path === '/auth/login') {
        loginUser($pdo, $request);
        return;
    }

    if ($method === 'POST' && $path === '/auth/logout') {
        logoutUser($pdo, $request);
        return;
    }

    if ($method === 'GET' && $path === '/auth/me') {
        getCurrentUser($pdo, $request);
        return;
    }

    if ($method === 'PATCH' && $path === '/auth/me') {
        updateCurrentUser($pdo, $request);
        return;
    }

    if ($method === 'POST' && $path === '/auth/password') {
        changeCurrentUserPassword($pdo, $request);
        return;
    }

    if ($path === '/auth/api-tokens') {
        $user = Auth::requireUser($pdo, $request);
        if ($method === 'GET') {
            listApiTokens($pdo, $user['id']);
            return;
        }
        if ($method === 'POST') {
            createApiToken($pdo, $request, $user['id']);
            return;
        }
    }

    if ($method === 'DELETE' && preg_match('#^/auth/api-tokens/(\d+)$#', $path, $m)) {
        $user = Auth::requireUser($pdo, $request);
        revokeApiToken($pdo, (int)$m[1], $user['id']);
        return;
    }

    if ($method === 'GET' && $path === '/groups') {
        listGroups($pdo, $request);
        return;
    }

    if ($method === 'POST' && $path === '/groups') {
        createGroup($pdo, $request);
        return;
    }

    if (preg_match('#^/groups/([^/]+)/members$#', $path, $m)) {
        if ($method === 'GET') {
            listGroupMembers($pdo, $request, $m[1]);
            return;
        }
        if ($method === 'POST') {
            addGroupMember($pdo, $request, $m[1]);
            return;
        }
    }

    if ($method === 'DELETE' && preg_match('#^/groups/([^/]+)/members/([^/]+)$#', $path, $m)) {
        removeGroupMember($pdo, $request, $m[1], $m[2]);
        return;
    }

    if ($method === 'DELETE' && preg_match('#^/groups/([^/]+)$#', $path, $m)) {
        deleteGroup($pdo, $request, $m[1]);
        return;
    }

    if ($method === 'GET' && $path === '/projects') {
        listProjects($pdo, $request);
        return;
    }

    if ($method === 'POST' && $path === '/projects') {
        createProject($pdo, $request);
        return;
    }

    if ($method === 'GET' && preg_match('#^/projects/([^/]+)/events$#', $path, $m)) {
        listProjectEvents($pdo, $request, $m[1]);
        return;
    }

    if (preg_match('#^/projects/([^/]+)$#', $path, $m)) {
        if ($method === 'GET') {
            getProject($pdo, $m[1], 200, $request);
            return;
        }
        if ($method === 'PATCH') {
            updateProject($pdo, $request, $m[1]);
            return;
        }
        if ($method === 'DELETE') {
            deleteProject($pdo, $request, $m[1]);
            return;
        }
    }

    if (preg_match('#^/projects/([^/]+)/tasks$#', $path, $m)) {
        if ($method === 'GET') {
            listTasks($pdo, $request, $m[1]);
            return;
        }
        if ($method === 'POST') {
            createTask($pdo, $request, $m[1], null);
            return;
        }
    }

    if ($method === 'PATCH' && preg_match('#^/projects/([^/]+)/guest-view$#', $path, $m)) {
        updateProjectGuestView($pdo, $request, $m[1]);
        return;
    }

    if ($method === 'POST' && preg_match('#^/projects/([^/]+)/guest-view/rotate$#', $path, $m)) {
        rotateProjectGuestView($pdo, $request, $m[1]);
        return;
    }

    if (preg_match('#^/tasks/([^/]+)$#', $path, $m)) {
        if ($method === 'GET') {
            getTask($pdo, $m[1], 200, $request);
            return;
        }
        if ($method === 'PATCH') {
            updateTask($pdo, $request, $m[1]);
            return;
        }
        if ($method === 'DELETE') {
            deleteTask($pdo, $request, $m[1]);
            return;
        }
    }

    if ($method === 'POST' && preg_match('#^/tasks/([^/]+)/children$#', $path, $m)) {
        createChildTask($pdo, $request, $m[1]);
        return;
    }

    if ($method === 'POST' && preg_match('#^/tasks/([^/]+)/move$#', $path, $m)) {
        moveTask($pdo, $request, $m[1]);
        return;
    }

    if (preg_match('#^/tasks/([^/]+)/logs$#', $path, $m)) {
        if ($method === 'GET') {
            listTaskLogs($pdo, $request, $m[1]);
            return;
        }
        if ($method === 'POST') {
            createTaskLog($pdo, $request, $m[1]);
            return;
        }
    }

    if ($method === 'GET' && $path === '/admin/setup') {
        getAdminSetupStatus($pdo, $config);
        return;
    }

    if ($method === 'POST' && $path === '/admin/setup') {
        setupAdminToken($pdo, $request, $config);
        return;
    }

    if ($path === '/admin/api-tokens') {
        Auth::requireAdmin($pdo, $request, $config);
        if ($method === 'GET') {
            listApiTokens($pdo);
            return;
        }
        if ($method === 'POST') {
            createApiToken($pdo, $request);
            return;
        }
    }

    if ($method === 'DELETE' && preg_match('#^/admin/api-tokens/(\d+)$#', $path, $m)) {
        Auth::requireAdmin($pdo, $request, $config);
        revokeApiToken($pdo, (int)$m[1]);
        return;
    }

    if ($method === 'POST' && $path === '/admin/users/password') {
        Auth::requireAdmin($pdo, $request, $config);
        resetUserPassword($pdo, $request);
        return;
    }

    if ($path === '/admin/users') {
        Auth::requireAdmin($pdo, $request, $config);
        if ($method === 'GET') {
            listAdminUsers($pdo);
            return;
        }
    }

    if (preg_match('#^/admin/users/([^/]+)$#', $path, $m)) {
        Auth::requireAdmin($pdo, $request, $config);
        if ($method === 'GET') {
            getAdminUser($pdo, $m[1]);
            return;
        }
        if ($method === 'PATCH') {
            updateAdminUserStatus($pdo, $request, $m[1]);
            return;
        }
    }

    if ($method === 'POST' && preg_match('#^/admin/users/([^/]+)/password$#', $path, $m)) {
        Auth::requireAdmin($pdo, $request, $config);
        resetUserPassword($pdo, $request, $m[1]);
        return;
    }

    if ($method === 'GET' && $path === '/agent/me') {
        getAgentMe($pdo, $request, $config);
        return;
    }

    if ($method === 'GET' && $path === '/agent/docs') {
        getAgentDocs($pdo, $request, $config);
        return;
    }

    if ($method === 'GET' && $path === '/agent/tasks/available') {
        $agentToken = Auth::requireAgentToken($pdo, $request, $config);
        listAvailableAgentTasks($pdo, $agentToken['user_id'] ?? null);
        return;
    }

    if ($method === 'GET' && preg_match('#^/agent/tasks/([^/]+)/context$#', $path, $m)) {
        $agentToken = Auth::requireAgentToken($pdo, $request, $config);
        getAgentTaskContext($pdo, $m[1], $agentToken['user_id'] ?? null);
        return;
    }

    if ($method === 'POST' && preg_match('#^/agent/tasks/([^/]+)/children$#', $path, $m)) {
        $agentToken = Auth::requireAgentToken($pdo, $request, $config);
        createAgentChildTask($pdo, $request, $m[1], formatAgentActorLabel($agentToken), $agentToken['user_id'] ?? null);
        return;
    }

    if ($method === 'POST' && preg_match('#^/agent/tasks/([^/]+)/(claim|start|block|complete|report)$#', $path, $m)) {
        $agentToken = Auth::requireAgentToken($pdo, $request, $config);
        updateAgentTask($pdo, $request, $m[1], $m[2], formatAgentActorLabel($agentToken), $agentToken['user_id'] ?? null);
        return;
    }

    Response::error('Not found.', 404);
}

function publicUser(array $user): array
{
    return [
        'id' => $user['id'],
        'email' => $user['email'],
        'name' => $user['name'],
        'avatar_color' => $user['avatar_color'] ?? '#155eef',
        'avatar_image' => $user['avatar_image'] ?? null,
    ];
}

function createUserSession(PDO $pdo, string $userId): string
{
    $plain = 'qwu_' . bin2hex(random_bytes(24));
    $stmt = $pdo->prepare(
        'INSERT INTO user_sessions (user_id, token_hash, created_at, expires_at)
         VALUES (:user_id, :token_hash, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY))',
    );
    $stmt->execute([
        ':user_id' => $userId,
        ':token_hash' => hash('sha256', $plain),
    ]);

    return $plain;
}

function createOwnedGroup(PDO $pdo, string $userId, string $name): array
{
    $groupId = now_id('group');
    $stmt = $pdo->prepare(
        'INSERT INTO user_groups (id, name, created_by, created_at, updated_at)
         VALUES (:id, :name, :created_by, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
    );
    $stmt->execute([
        ':id' => $groupId,
        ':name' => $name,
        ':created_by' => $userId,
    ]);

    $member = $pdo->prepare(
        'INSERT INTO group_members (group_id, user_id, role, created_at)
         VALUES (:group_id, :user_id, "owner", UTC_TIMESTAMP())',
    );
    $member->execute([
        ':group_id' => $groupId,
        ':user_id' => $userId,
    ]);

    return getGroup($pdo, $groupId, $userId);
}

function getGroup(PDO $pdo, string $groupId, string $userId): array
{
    $stmt = $pdo->prepare(
        'SELECT user_groups.id, user_groups.name, group_members.role, user_groups.created_at, user_groups.updated_at
         FROM user_groups
         INNER JOIN group_members ON group_members.group_id = user_groups.id
         WHERE user_groups.id = :id AND group_members.user_id = :user_id AND user_groups.deleted_at IS NULL',
    );
    $stmt->execute([':id' => $groupId, ':user_id' => $userId]);
    $group = $stmt->fetch();
    if (!$group) {
        Response::error('Group not found.', 404);
        exit;
    }

    return $group;
}

function listUserGroups(PDO $pdo, string $userId): array
{
    $stmt = $pdo->prepare(
        'SELECT user_groups.id, user_groups.name, group_members.role, user_groups.created_at, user_groups.updated_at
         FROM user_groups
         INNER JOIN group_members ON group_members.group_id = user_groups.id
         WHERE group_members.user_id = :user_id AND user_groups.deleted_at IS NULL
         ORDER BY user_groups.updated_at DESC, user_groups.created_at DESC',
    );
    $stmt->execute([':user_id' => $userId]);
    return $stmt->fetchAll();
}

function requireGroupMember(PDO $pdo, string $groupId, string $userId): void
{
    $stmt = $pdo->prepare(
        'SELECT 1 FROM group_members
         INNER JOIN user_groups ON user_groups.id = group_members.group_id
         WHERE group_members.group_id = :group_id
           AND group_members.user_id = :user_id
           AND user_groups.deleted_at IS NULL',
    );
    $stmt->execute([':group_id' => $groupId, ':user_id' => $userId]);
    if (!$stmt->fetchColumn()) {
        Response::error('Group not found.', 404);
        exit;
    }
}

function requireGroupOwner(PDO $pdo, string $groupId, string $userId): void
{
    $stmt = $pdo->prepare(
        'SELECT group_members.role
         FROM user_groups
         LEFT JOIN group_members
           ON group_members.group_id = user_groups.id
          AND group_members.user_id = :user_id
         WHERE user_groups.id = :group_id
           AND user_groups.deleted_at IS NULL',
    );
    $stmt->execute([':group_id' => $groupId, ':user_id' => $userId]);
    $role = $stmt->fetchColumn();
    if ($role === false) {
        Response::error('Group not found.', 404);
        exit;
    }
    if ($role !== 'owner') {
        Response::error('Group owner required.', 403);
        exit;
    }
}

function publicGroupMember(array $member): array
{
    return [
        'user_id' => $member['user_id'],
        'email' => $member['email'],
        'name' => $member['name'],
        'avatar_color' => $member['avatar_color'] ?? '#155eef',
        'avatar_image' => $member['avatar_image'] ?? null,
        'role' => $member['role'],
        'created_at' => $member['created_at'],
    ];
}

function ensureUniqueUserName(PDO $pdo, string $name, ?string $exceptUserId = null): void
{
    $sql = 'SELECT id FROM users WHERE name = :name AND deleted_at IS NULL';
    $params = [':name' => $name];
    if ($exceptUserId !== null) {
        $sql .= ' AND id <> :id';
        $params[':id'] = $exceptUserId;
    }

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    if ($stmt->fetchColumn()) {
        Response::error('User name is already taken.', 409);
        exit;
    }
}

function findUserIdByIdentifier(PDO $pdo, string $identifier): ?string
{
    $stmt = $pdo->prepare(
        'SELECT id FROM users
         WHERE deleted_at IS NULL
           AND (email = :email OR name = :name)',
    );
    $stmt->execute([
        ':email' => strtolower($identifier),
        ':name' => $identifier,
    ]);
    $userId = $stmt->fetchColumn();
    return $userId ? (string)$userId : null;
}

function registerUser(PDO $pdo, Request $request): void
{
    $name = Validation::requireString($request->body, 'name');
    $email = strtolower(Validation::requireString($request->body, 'email'));
    $password = Validation::requireString($request->body, 'password');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        Response::error('Invalid email.', 422);
        return;
    }
    if (strlen($password) < 8) {
        Response::error('Password must be at least 8 characters.', 422);
        return;
    }
    ensureUniqueUserName($pdo, $name);

    $id = now_id('user');
    try {
        $pdo->beginTransaction();
        $stmt = $pdo->prepare(
            'INSERT INTO users (id, email, name, avatar_color, password_hash, created_at, updated_at)
             VALUES (:id, :email, :name, \'#155eef\', :password_hash, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
        );
        $stmt->execute([
            ':id' => $id,
            ':email' => $email,
            ':name' => $name,
            ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
        ]);
        $token = createUserSession($pdo, $id);
        $pdo->commit();
    } catch (PDOException $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if ($error->getCode() === '23000') {
            Response::error('Email is already registered.', 409);
            return;
        }
        throw $error;
    }

    Response::json([
        'user' => ['id' => $id, 'email' => $email, 'name' => $name, 'avatar_color' => '#155eef', 'avatar_image' => null],
        'token' => $token,
        'groups' => [],
    ], 201);
}

function loginUser(PDO $pdo, Request $request): void
{
    $email = strtolower(Validation::requireString($request->body, 'email'));
    $password = Validation::requireString($request->body, 'password');

    $stmt = $pdo->prepare(
        'SELECT id, email, name, avatar_color, avatar_image, password_hash, suspended_until, disabled_at
         FROM users WHERE email = :email AND deleted_at IS NULL',
    );
    $stmt->execute([':email' => $email]);
    $user = $stmt->fetch();
    if (!$user || !password_verify($password, (string)$user['password_hash'])) {
        Response::error('Invalid email or password.', 401);
        return;
    }
    if ($user['disabled_at'] !== null) {
        Response::error('Account is disabled.', 403);
        return;
    }
    if ($user['suspended_until'] !== null && strtotime((string)$user['suspended_until']) > time()) {
        Response::error('Account is temporarily suspended.', 403);
        return;
    }

    Response::json([
        'user' => publicUser($user),
        'token' => createUserSession($pdo, $user['id']),
        'groups' => listUserGroups($pdo, $user['id']),
    ]);
}

function logoutUser(PDO $pdo, Request $request): void
{
    $token = $request->userToken();
    if ($token !== null) {
        $stmt = $pdo->prepare('DELETE FROM user_sessions WHERE token_hash = :hash');
        $stmt->execute([':hash' => hash('sha256', $token)]);
    }
    Response::json(['ok' => true]);
}

function getCurrentUser(PDO $pdo, Request $request): void
{
    $user = Auth::requireUser($pdo, $request);
    Response::json([
        'user' => publicUser($user),
        'groups' => listUserGroups($pdo, $user['id']),
    ]);
}

function updateCurrentUser(PDO $pdo, Request $request): void
{
    $user = Auth::requireUser($pdo, $request);
    $fields = pick($request->body, ['name', 'avatar_color', 'avatar_image']);
    if ($fields === []) {
        Response::error('No fields to update.', 422);
        return;
    }

    if (array_key_exists('name', $fields)) {
        $fields['name'] = trim((string)$fields['name']);
        if ($fields['name'] === '') {
            Response::error('Missing required field: name', 422);
            return;
        }
        ensureUniqueUserName($pdo, $fields['name'], $user['id']);
    }
    if (array_key_exists('avatar_color', $fields)) {
        $fields['avatar_color'] = Validation::color($fields, 'avatar_color') ?? '#155eef';
    }
    if (array_key_exists('avatar_image', $fields)) {
        $value = $fields['avatar_image'];
        if ($value === null || $value === '') {
            $fields['avatar_image'] = null;
        } else {
            $value = (string)$value;
            if (strlen($value) > 350000 || !preg_match('#^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$#', $value)) {
                Response::error('Invalid avatar image.', 422);
                return;
            }
            $fields['avatar_image'] = $value;
        }
    }

    $sets = [];
    $params = [':id' => $user['id']];
    foreach ($fields as $key => $value) {
        $sets[] = "{$key} = :{$key}";
        $params[":{$key}"] = $value;
    }

    $stmt = $pdo->prepare(
        'UPDATE users SET ' . implode(', ', $sets) . ', updated_at = UTC_TIMESTAMP()
         WHERE id = :id AND deleted_at IS NULL',
    );
    $stmt->execute($params);

    $next = $pdo->prepare('SELECT id, email, name, avatar_color, avatar_image FROM users WHERE id = :id AND deleted_at IS NULL');
    $next->execute([':id' => $user['id']]);
    Response::json(['user' => publicUser($next->fetch())]);
}

function changeCurrentUserPassword(PDO $pdo, Request $request): void
{
    $user = Auth::requireUser($pdo, $request);
    $currentPassword = Validation::requireString($request->body, 'current_password');
    $newPassword = Validation::requireString($request->body, 'new_password');
    if (strlen($newPassword) < 8) {
        Response::error('Password must be at least 8 characters.', 422);
        return;
    }

    $stmt = $pdo->prepare('SELECT password_hash FROM users WHERE id = :id AND deleted_at IS NULL');
    $stmt->execute([':id' => $user['id']]);
    $hash = $stmt->fetchColumn();
    if (!$hash || !password_verify($currentPassword, (string)$hash)) {
        Response::error('Invalid current password.', 401);
        return;
    }

    $update = $pdo->prepare('UPDATE users SET password_hash = :hash, updated_at = UTC_TIMESTAMP() WHERE id = :id');
    $update->execute([
        ':id' => $user['id'],
        ':hash' => password_hash($newPassword, PASSWORD_DEFAULT),
    ]);
    $sessions = $pdo->prepare('DELETE FROM user_sessions WHERE user_id = :id');
    $sessions->execute([':id' => $user['id']]);
    Response::json(['ok' => true]);
}

function listGroups(PDO $pdo, Request $request): void
{
    $user = Auth::requireUser($pdo, $request);
    Response::json(['groups' => listUserGroups($pdo, $user['id'])]);
}

function createGroup(PDO $pdo, Request $request): void
{
    $user = Auth::requireUser($pdo, $request);
    $name = Validation::requireString($request->body, 'name');
    $group = createOwnedGroup($pdo, $user['id'], $name);
    Response::json(['group' => $group], 201);
}

function listGroupMembers(PDO $pdo, Request $request, string $groupId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireGroupMember($pdo, $groupId, $user['id']);

    $stmt = $pdo->prepare(
        'SELECT group_members.user_id, group_members.role, group_members.created_at,
                users.email, users.name, users.avatar_color, users.avatar_image
         FROM group_members
         INNER JOIN users ON users.id = group_members.user_id
         WHERE group_members.group_id = :group_id AND users.deleted_at IS NULL
         ORDER BY group_members.role ASC, users.name ASC',
    );
    $stmt->execute([':group_id' => $groupId]);
    Response::json(['members' => array_map('publicGroupMember', $stmt->fetchAll())]);
}

function addGroupMember(PDO $pdo, Request $request, string $groupId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireGroupOwner($pdo, $groupId, $user['id']);

    $identifier = Validation::requireString($request->body, 'identifier');
    $memberUserId = findUserIdByIdentifier($pdo, $identifier);
    if (!$memberUserId) {
        Response::error('User not found.', 404);
        return;
    }

    $insert = $pdo->prepare(
        'INSERT INTO group_members (group_id, user_id, role, created_at)
         VALUES (:group_id, :user_id, "member", UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE role = role',
    );
    $insert->execute([
        ':group_id' => $groupId,
        ':user_id' => $memberUserId,
    ]);

    $groupUpdate = $pdo->prepare('UPDATE user_groups SET updated_at = UTC_TIMESTAMP() WHERE id = :id');
    $groupUpdate->execute([':id' => $groupId]);
    listGroupMembers($pdo, $request, $groupId);
}

function removeGroupMember(PDO $pdo, Request $request, string $groupId, string $memberUserId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireGroupOwner($pdo, $groupId, $user['id']);
    if ($memberUserId === $user['id']) {
        Response::error('Owner cannot remove self.', 422);
        return;
    }

    $stmt = $pdo->prepare('DELETE FROM group_members WHERE group_id = :group_id AND user_id = :user_id AND role <> "owner"');
    $stmt->execute([':group_id' => $groupId, ':user_id' => $memberUserId]);

    $groupUpdate = $pdo->prepare('UPDATE user_groups SET updated_at = UTC_TIMESTAMP() WHERE id = :id');
    $groupUpdate->execute([':id' => $groupId]);
    Response::json(['ok' => true]);
}

function deleteGroup(PDO $pdo, Request $request, string $groupId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireGroupOwner($pdo, $groupId, $user['id']);

    $projects = $pdo->prepare(
        'SELECT 1 FROM projects
         WHERE group_id = :group_id AND deleted_at IS NULL
         LIMIT 1',
    );
    $projects->execute([':group_id' => $groupId]);
    if ($projects->fetchColumn()) {
        Response::error('Group has active projects. Move or delete projects before deleting the group.', 409);
        return;
    }

    $stmt = $pdo->prepare(
        'UPDATE user_groups
         SET deleted_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
         WHERE id = :id AND deleted_at IS NULL',
    );
    $stmt->execute([':id' => $groupId]);
    if ($stmt->rowCount() === 0) {
        Response::error('Group not found.', 404);
        return;
    }

    Response::json(['ok' => true]);
}

function emitProjectEvent(
    PDO $pdo,
    string $projectId,
    ?string $actorUserId,
    string $eventType,
    string $targetType,
    ?string $targetId,
    ?string $summary = null,
    ?array $payload = null,
): void {
    try {
        $stmt = $pdo->prepare(
            'INSERT INTO project_events (
                project_id, actor_user_id, event_type, target_type, target_id, summary, payload, created_at
             ) VALUES (
                :project_id, :actor_user_id, :event_type, :target_type, :target_id, :summary, :payload, UTC_TIMESTAMP()
             )',
        );
        $stmt->execute([
            ':project_id' => $projectId,
            ':actor_user_id' => $actorUserId,
            ':event_type' => $eventType,
            ':target_type' => $targetType,
            ':target_id' => $targetId,
            ':summary' => $summary,
            ':payload' => $payload === null
                ? null
                : json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
        ]);
    } catch (Throwable $error) {
        error_log(sprintf(
            'Quick WBS project event failed: project=%s event=%s target=%s error=%s',
            $projectId,
            $eventType,
            $targetId ?? '-',
            $error->getMessage(),
        ));
    }
}

function requestedEventId(): ?int
{
    if (!array_key_exists('since', $_GET) || $_GET['since'] === '') {
        return null;
    }

    $value = filter_var($_GET['since'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
    if ($value === false) {
        Response::error('Invalid since event id.', 422);
        exit;
    }

    return (int)$value;
}

function latestProjectEventId(PDO $pdo, string $projectId): int
{
    $stmt = $pdo->prepare('SELECT COALESCE(MAX(id), 0) FROM project_events WHERE project_id = :project_id');
    $stmt->execute([':project_id' => $projectId]);
    return (int)$stmt->fetchColumn();
}

function fetchProjectEvents(PDO $pdo, string $projectId, int $since, bool $includePrivateFields): array
{
    $columns = $includePrivateFields
        ? 'id, project_id, actor_user_id, event_type, target_type, target_id, summary, payload, created_at'
        : 'id, project_id, event_type, target_type, target_id, summary, created_at';
    $stmt = $pdo->prepare(
        'SELECT ' . $columns . '
         FROM project_events
         WHERE project_id = :project_id AND id > :since
         ORDER BY id ASC
         LIMIT 100',
    );
    $stmt->bindValue(':project_id', $projectId);
    $stmt->bindValue(':since', $since, PDO::PARAM_INT);
    $stmt->execute();
    $events = $stmt->fetchAll();

    if ($includePrivateFields) {
        foreach ($events as &$event) {
            $event['payload'] = $event['payload'] === null ? null : json_decode((string)$event['payload'], true);
        }
        unset($event);
    }

    return $events;
}

function listProjectEvents(PDO $pdo, Request $request, string $projectId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireProjectReadAccess($pdo, $projectId, $user['id']);
    $since = requestedEventId();
    if ($since === null) {
        Response::json(['events' => [], 'latest_event_id' => latestProjectEventId($pdo, $projectId)]);
        return;
    }

    $events = fetchProjectEvents($pdo, $projectId, $since, true);
    $latest = $events === [] ? latestProjectEventId($pdo, $projectId) : (int)end($events)['id'];
    Response::json(['events' => $events, 'latest_event_id' => $latest]);
}

function listGuestProjectEvents(PDO $pdo, string $guestToken): void
{
    $project = requireProjectGuestAccess($pdo, $guestToken);
    $since = requestedEventId();
    if ($since === null) {
        Response::json(['events' => [], 'latest_event_id' => latestProjectEventId($pdo, $project['id'])]);
        return;
    }

    $events = fetchProjectEvents($pdo, $project['id'], $since, false);
    $latest = $events === [] ? latestProjectEventId($pdo, $project['id']) : (int)end($events)['id'];
    Response::json(['events' => $events, 'latest_event_id' => $latest]);
}

function listProjects(PDO $pdo, Request $request): void
{
    $user = Auth::requireUser($pdo, $request);
    $groupId = trim((string)($_GET['group_id'] ?? ''));
    $sql =
        'SELECT projects.id, projects.name, projects.description, projects.group_id, projects.owner_user_id,
                projects.guest_view_enabled, projects.guest_view_token,
                projects.guest_view_created_at, projects.guest_view_updated_at,
                projects.created_by, projects.updated_by, projects.created_at, projects.updated_at
         FROM projects
         LEFT JOIN user_groups ON user_groups.id = projects.group_id AND user_groups.deleted_at IS NULL
         LEFT JOIN group_members
           ON group_members.group_id = projects.group_id
          AND group_members.user_id = :member_user_id
          AND user_groups.id IS NOT NULL
         WHERE projects.deleted_at IS NULL
           AND (
                (projects.group_id IS NULL AND projects.owner_user_id = :owner_user_id)
                OR group_members.user_id IS NOT NULL
           )';
    $params = [':member_user_id' => $user['id'], ':owner_user_id' => $user['id']];
    if ($groupId === 'personal') {
        $sql .= ' AND projects.group_id IS NULL AND projects.owner_user_id = :personal_owner_user_id';
        $params[':personal_owner_user_id'] = $user['id'];
    } elseif ($groupId !== '') {
        requireGroupMember($pdo, $groupId, $user['id']);
        $sql .= ' AND projects.group_id = :group_id';
        $params[':group_id'] = $groupId;
    }
    $sql .= ' ORDER BY projects.updated_at DESC';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    Response::json(['projects' => $stmt->fetchAll()]);
}

function createProject(PDO $pdo, Request $request): void
{
    $id = now_id('project');
    $name = Validation::requireString($request->body, 'name');
    $user = Auth::requireUser($pdo, $request);
    $actor = $user['name'];
    $groupId = $request->body['group_id'] ?? null;
    if ($groupId === 'personal') {
        $groupId = null;
    }
    if ($groupId !== null && $groupId !== '') {
        requireGroupMember($pdo, (string)$groupId, $user['id']);
    }

    $stmt = $pdo->prepare(
        'INSERT INTO projects (id, name, description, group_id, owner_user_id, created_by, updated_by, created_at, updated_at)
         VALUES (:id, :name, :description, :group_id, :owner_user_id, :created_by, :updated_by, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
    );
    $stmt->execute([
        ':id' => $id,
        ':name' => $name,
        ':description' => $request->body['description'] ?? null,
        ':group_id' => $groupId ?: null,
        ':owner_user_id' => $user['id'],
        ':created_by' => $actor,
        ':updated_by' => $actor,
    ]);

    getProject($pdo, $id, 201);
}

function getProject(PDO $pdo, string $projectId, int $status = 200, ?Request $request = null): void
{
    if ($request !== null) {
        $user = Auth::requireUser($pdo, $request);
        requireProjectReadAccess($pdo, $projectId, $user['id']);
    }

    $stmt = $pdo->prepare(
        'SELECT id, name, description, group_id, owner_user_id,
                guest_view_enabled, guest_view_token, guest_view_created_at, guest_view_updated_at,
                created_by, updated_by, created_at, updated_at
         FROM projects WHERE id = :id AND deleted_at IS NULL',
    );
    $stmt->execute([':id' => $projectId]);
    $project = $stmt->fetch();
    if (!$project) {
        Response::error('Project not found.', 404);
        return;
    }

    Response::json(['project' => $project], $status);
}

function updateProject(PDO $pdo, Request $request, string $projectId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireProjectWriteAccess($pdo, $projectId, $user['id']);

    $fields = pick($request->body, ['name', 'description', 'group_id']);
    if ($fields === []) {
        Response::error('No fields to update.', 422);
        return;
    }

    if (array_key_exists('group_id', $fields)) {
        if ($fields['group_id'] === '' || $fields['group_id'] === 'personal') {
            $fields['group_id'] = null;
        }
        requireProjectOwner($pdo, $projectId, $user['id']);
        if ($fields['group_id']) {
            requireGroupMember($pdo, (string)$fields['group_id'], $user['id']);
        }
    }

    $actor = $user['name'];
    $sets = [];
    $params = [':id' => $projectId, ':updated_by' => $actor];
    foreach ($fields as $key => $value) {
        $sets[] = "{$key} = :{$key}";
        $params[":{$key}"] = $value;
    }

    $sql = 'UPDATE projects SET ' . implode(', ', $sets) . ', updated_by = :updated_by, updated_at = UTC_TIMESTAMP()
            WHERE id = :id AND deleted_at IS NULL';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    emitProjectEvent(
        $pdo,
        $projectId,
        $user['id'],
        'project.updated',
        'project',
        $projectId,
        'プロジェクトが更新されました',
        ['fields' => array_keys($fields)],
    );
    getProject($pdo, $projectId);
}

function deleteProject(PDO $pdo, Request $request, string $projectId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireProjectWriteAccess($pdo, $projectId, $user['id']);

    $stmt = $pdo->prepare(
        'UPDATE projects SET deleted_at = UTC_TIMESTAMP(), updated_by = :updated_by, updated_at = UTC_TIMESTAMP()
         WHERE id = :id AND deleted_at IS NULL',
    );
    $actor = $user['name'];
    $stmt->execute([':id' => $projectId, ':updated_by' => $actor]);
    Response::json(['ok' => true]);
}

function requireProjectReadAccess(PDO $pdo, string $projectId, string $userId): void
{
    $stmt = $pdo->prepare(
        'SELECT projects.id
         FROM projects
         LEFT JOIN user_groups ON user_groups.id = projects.group_id AND user_groups.deleted_at IS NULL
         LEFT JOIN group_members
           ON group_members.group_id = projects.group_id
          AND group_members.user_id = :member_user_id
          AND user_groups.id IS NOT NULL
         WHERE projects.id = :id
           AND projects.deleted_at IS NULL
           AND (
                (projects.group_id IS NULL AND projects.owner_user_id = :owner_user_id)
                OR group_members.user_id IS NOT NULL
           )',
    );
    $stmt->execute([':id' => $projectId, ':member_user_id' => $userId, ':owner_user_id' => $userId]);
    if (!$stmt->fetchColumn()) {
        Response::error('Project not found.', 404);
        exit;
    }
}

function requireProjectWriteAccess(PDO $pdo, string $projectId, string $userId): void
{
    requireProjectReadAccess($pdo, $projectId, $userId);
}

function requireProjectGuestAccess(PDO $pdo, string $guestToken): array
{
    $stmt = $pdo->prepare(
        'SELECT id, name, description, created_by, created_at, updated_at
         FROM projects
         WHERE guest_view_token = :token
           AND guest_view_enabled = 1
           AND deleted_at IS NULL',
    );
    $stmt->execute([':token' => $guestToken]);
    $project = $stmt->fetch();
    if (!$project) {
        Response::error('Not found.', 404);
        exit;
    }

    return $project;
}

function requireProjectOwner(PDO $pdo, string $projectId, string $userId): void
{
    $stmt = $pdo->prepare(
        'SELECT 1 FROM projects
         WHERE id = :id AND owner_user_id = :user_id AND deleted_at IS NULL',
    );
    $stmt->execute([':id' => $projectId, ':user_id' => $userId]);
    if (!$stmt->fetchColumn()) {
        Response::error('Project owner required.', 403);
        exit;
    }
}

function requireTaskAccess(PDO $pdo, string $taskId, string $userId): void
{
    $stmt = $pdo->prepare(
        'SELECT tasks.id
         FROM tasks
         INNER JOIN projects ON projects.id = tasks.project_id
         LEFT JOIN user_groups ON user_groups.id = projects.group_id AND user_groups.deleted_at IS NULL
         LEFT JOIN group_members
           ON group_members.group_id = projects.group_id
          AND group_members.user_id = :member_user_id
          AND user_groups.id IS NOT NULL
         WHERE tasks.id = :id
           AND tasks.deleted_at IS NULL
           AND projects.deleted_at IS NULL
           AND (
                (projects.group_id IS NULL AND projects.owner_user_id = :owner_user_id)
                OR group_members.user_id IS NOT NULL
           )',
    );
    $stmt->execute([':id' => $taskId, ':member_user_id' => $userId, ':owner_user_id' => $userId]);
    if (!$stmt->fetchColumn()) {
        Response::error('Task not found.', 404);
        exit;
    }
}

function listTasks(PDO $pdo, Request $request, string $projectId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireProjectReadAccess($pdo, $projectId, $user['id']);

    $stmt = $pdo->prepare(
        'SELECT * FROM tasks
         WHERE project_id = :project_id AND deleted_at IS NULL
         ORDER BY COALESCE(parent_id, \'\'), sort_order, created_at',
    );
    $stmt->execute([':project_id' => $projectId]);
    Response::json(['tasks' => $stmt->fetchAll()]);
}

function createTask(PDO $pdo, Request $request, string $projectId, ?string $parentId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireProjectWriteAccess($pdo, $projectId, $user['id']);

    $id = now_id('task');
    $actor = $user['name'];
    $status = Validation::optionalEnum($request->body, 'status', Validation::STATUSES) ?? 'todo';
    $priority = Validation::optionalEnum($request->body, 'priority', Validation::PRIORITIES) ?? 'medium';
    $assigneeType = Validation::optionalEnum($request->body, 'assignee_type', Validation::ASSIGNEE_TYPES);
    $ganttColor = Validation::color($request->body, 'gantt_color');

    $stmt = $pdo->prepare(
        'INSERT INTO tasks (
            id, project_id, parent_id, title, description, status, priority, assignee_type,
            assignee_name, acceptance_criteria, start_date, due_date, estimate_hours,
            actual_hours, gantt_color, progress, sort_order, created_by, updated_by, created_at, updated_at
         ) VALUES (
            :id, :project_id, :parent_id, :title, :description, :status, :priority, :assignee_type,
            :assignee_name, :acceptance_criteria, :start_date, :due_date, :estimate_hours,
            :actual_hours, :gantt_color, :progress, :sort_order, :created_by, :updated_by, UTC_TIMESTAMP(), UTC_TIMESTAMP()
         )',
    );
    $stmt->execute([
        ':id' => $id,
        ':project_id' => $projectId,
        ':parent_id' => $parentId,
        ':title' => Validation::requireString($request->body, 'title'),
        ':description' => $request->body['description'] ?? null,
        ':status' => $status,
        ':priority' => $priority,
        ':assignee_type' => $assigneeType,
        ':assignee_name' => $request->body['assignee_name'] ?? null,
        ':acceptance_criteria' => $request->body['acceptance_criteria'] ?? null,
        ':start_date' => $request->body['start_date'] ?? null,
        ':due_date' => $request->body['due_date'] ?? null,
        ':estimate_hours' => $request->body['estimate_hours'] ?? null,
        ':actual_hours' => $request->body['actual_hours'] ?? null,
        ':gantt_color' => $ganttColor,
        ':progress' => Validation::progress($request->body),
        ':sort_order' => array_key_exists('sort_order', $request->body)
            ? (int)$request->body['sort_order']
            : nextTaskSortOrder($pdo, $projectId, $parentId),
        ':created_by' => $actor,
        ':updated_by' => $actor,
    ]);

    TaskLog::create($pdo, $id, 'human', $actor, 'created', null);
    emitProjectEvent(
        $pdo,
        $projectId,
        $user['id'],
        'task.created',
        'task',
        $id,
        'タスクが追加されました',
        ['parent_id' => $parentId],
    );
    getTask($pdo, $id, 201);
}

function createChildTask(PDO $pdo, Request $request, string $parentId): void
{
    Auth::requireUser($pdo, $request);
    $stmt = $pdo->prepare('SELECT project_id FROM tasks WHERE id = :id AND deleted_at IS NULL');
    $stmt->execute([':id' => $parentId]);
    $parent = $stmt->fetch();
    if (!$parent) {
        Response::error('Parent task not found.', 404);
        return;
    }

    createTask($pdo, $request, $parent['project_id'], $parentId);
}

function nextTaskSortOrder(PDO $pdo, string $projectId, ?string $parentId): int
{
    if ($parentId === null) {
        $stmt = $pdo->prepare(
            'SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order
             FROM tasks
             WHERE project_id = :project_id AND parent_id IS NULL AND deleted_at IS NULL',
        );
        $stmt->execute([':project_id' => $projectId]);
    } else {
        $stmt = $pdo->prepare(
            'SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order
             FROM tasks
             WHERE project_id = :project_id AND parent_id = :parent_id AND deleted_at IS NULL',
        );
        $stmt->execute([':project_id' => $projectId, ':parent_id' => $parentId]);
    }

    return (int)($stmt->fetch()['next_order'] ?? 10);
}

function getTask(PDO $pdo, string $taskId, int $status = 200, ?Request $request = null): void
{
    if ($request !== null) {
        $user = Auth::requireUser($pdo, $request);
        requireTaskAccess($pdo, $taskId, $user['id']);
    }

    $stmt = $pdo->prepare('SELECT * FROM tasks WHERE id = :id AND deleted_at IS NULL');
    $stmt->execute([':id' => $taskId]);
    $task = $stmt->fetch();
    if (!$task) {
        Response::error('Task not found.', 404);
        return;
    }

    Response::json(['task' => $task], $status);
}

function updateTask(PDO $pdo, Request $request, string $taskId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireTaskAccess($pdo, $taskId, $user['id']);

    $allowed = [
        'parent_id', 'title', 'description', 'status', 'priority', 'assignee_type', 'assignee_name',
        'acceptance_criteria', 'start_date', 'due_date', 'estimate_hours', 'actual_hours',
        'gantt_color', 'progress', 'sort_order',
    ];
    $fields = pick($request->body, $allowed);
    if ($fields === []) {
        Response::error('No fields to update.', 422);
        return;
    }

    $currentStmt = $pdo->prepare('SELECT * FROM tasks WHERE id = :id AND deleted_at IS NULL');
    $currentStmt->execute([':id' => $taskId]);
    $currentValues = $currentStmt->fetch();
    if (!$currentValues) {
        Response::error('Task not found.', 404);
        return;
    }

    if (isset($fields['status'])) {
        Validation::optionalEnum($fields, 'status', Validation::STATUSES);
    }
    if (isset($fields['priority'])) {
        Validation::optionalEnum($fields, 'priority', Validation::PRIORITIES);
    }
    if (isset($fields['assignee_type'])) {
        Validation::optionalEnum($fields, 'assignee_type', Validation::ASSIGNEE_TYPES);
    }
    if (isset($fields['progress'])) {
        $fields['progress'] = Validation::progress($fields);
    }
    if (array_key_exists('gantt_color', $fields)) {
        $fields['gantt_color'] = Validation::color($fields, 'gantt_color');
    }
    if (array_key_exists('parent_id', $fields)) {
        $currentTask = findTaskForMove($pdo, $taskId);
        if (!$currentTask) {
            Response::error('Task not found.', 404);
            return;
        }

        $newParentId = normalizeParentId($fields['parent_id']);
        if ($newParentId === $taskId) {
            Response::error('Task cannot be moved under itself.', 422);
            return;
        }

        if ($newParentId !== null) {
            $parentTask = findTaskForMove($pdo, $newParentId);
            if (!$parentTask) {
                Response::error('Parent task not found.', 404);
                return;
            }
            if ($parentTask['project_id'] !== $currentTask['project_id']) {
                Response::error('Parent task must be in the same project.', 422);
                return;
            }

            $descendantIds = collectTaskDescendantIds($pdo, $taskId);
            if (in_array($newParentId, $descendantIds, true)) {
                Response::error('Task cannot be moved under its descendant.', 422);
                return;
            }
        }

        $fields['parent_id'] = $newParentId;
        if ($newParentId !== $currentTask['parent_id']) {
            $fields['sort_order'] = nextTaskSortOrder($pdo, $currentTask['project_id'], $newParentId);
        }
    }

    $changes = [];
    $parentChanged = array_key_exists('parent_id', $fields)
        && !taskLogValuesEqual($currentValues['parent_id'] ?? null, $fields['parent_id']);
    foreach ($fields as $key => $value) {
        $previous = $currentValues[$key] ?? null;
        if (taskLogValuesEqual($previous, $value)) {
            unset($fields[$key]);
            continue;
        }
        if (!($key === 'sort_order' && $parentChanged)) {
            $changes[] = formatTaskFieldChange($pdo, $key, $previous, $value);
        }
    }

    if ($fields === []) {
        getTask($pdo, $taskId);
        return;
    }

    $actor = $user['name'];
    $sets = [];
    $params = [':id' => $taskId, ':updated_by' => $actor];
    foreach ($fields as $key => $value) {
        $sets[] = "{$key} = :{$key}";
        $params[":{$key}"] = $value;
    }

    $sql = 'UPDATE tasks SET ' . implode(', ', $sets) . ', updated_by = :updated_by, updated_at = UTC_TIMESTAMP()
            WHERE id = :id AND deleted_at IS NULL';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    TaskLog::create($pdo, $taskId, 'human', $actor, 'updated', implode("\n", $changes));
    emitProjectEvent(
        $pdo,
        (string)$currentValues['project_id'],
        $user['id'],
        $parentChanged ? 'task.moved' : 'task.updated',
        'task',
        $taskId,
        $parentChanged ? 'タスクが移動されました' : 'タスクが更新されました',
        ['fields' => array_keys($fields)],
    );
    getTask($pdo, $taskId);
}

function taskLogValuesEqual(mixed $previous, mixed $next): bool
{
    if ($previous === null || $next === null) {
        return $previous === $next;
    }

    return (string)$previous === (string)$next;
}

function formatTaskFieldChange(PDO $pdo, string $field, mixed $previous, mixed $next): string
{
    $labels = [
        'parent_id' => '親タスク',
        'title' => 'タイトル',
        'description' => '説明',
        'status' => '状態',
        'priority' => '優先度',
        'assignee_type' => '担当種別',
        'assignee_name' => '担当者',
        'acceptance_criteria' => '受け入れ条件',
        'start_date' => '開始日',
        'due_date' => '期限',
        'estimate_hours' => '見積時間',
        'actual_hours' => '実績時間',
        'gantt_color' => 'ガント色',
        'progress' => '進捗',
        'sort_order' => '表示順',
    ];

    $label = $labels[$field] ?? $field;
    return $label . ': ' . formatTaskLogValue($pdo, $field, $previous) . ' → ' . formatTaskLogValue($pdo, $field, $next);
}

function formatTaskLogValue(PDO $pdo, string $field, mixed $value): string
{
    if ($value === null || $value === '') {
        return $field === 'parent_id' ? 'ルート' : '未設定';
    }

    $mapped = match ($field) {
        'status' => [
            'todo' => '未着手',
            'ready' => '着手可能',
            'in_progress' => '作業中',
            'blocked' => '停止中',
            'review' => 'レビュー',
            'done' => '完了',
        ][(string)$value] ?? (string)$value,
        'priority' => [
            'low' => '低',
            'medium' => '中',
            'high' => '高',
            'critical' => '緊急',
        ][(string)$value] ?? (string)$value,
        'assignee_type' => [
            'human' => 'ユーザ',
            'ai' => 'AI',
        ][(string)$value] ?? (string)$value,
        'progress' => (string)$value . '%',
        'estimate_hours', 'actual_hours' => (string)$value . '時間',
        'parent_id' => taskTitleForLog($pdo, (string)$value),
        default => (string)$value,
    };

    if (function_exists('mb_strlen') && mb_strlen($mapped) > 120) {
        return mb_substr($mapped, 0, 117) . '...';
    }

    return $mapped;
}

function taskTitleForLog(PDO $pdo, string $taskId): string
{
    $stmt = $pdo->prepare('SELECT title FROM tasks WHERE id = :id');
    $stmt->execute([':id' => $taskId]);
    $title = $stmt->fetchColumn();
    return $title ? (string)$title : $taskId;
}

function normalizeParentId(mixed $parentId): ?string
{
    if ($parentId === null) {
        return null;
    }

    $value = trim((string)$parentId);
    return $value === '' ? null : $value;
}

function moveTask(PDO $pdo, Request $request, string $taskId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireTaskAccess($pdo, $taskId, $user['id']);

    $direction = (string)($request->body['direction'] ?? '');
    if (!in_array($direction, ['up', 'down'], true)) {
        Response::error('Invalid move direction.', 422, ['allowed' => ['up', 'down']]);
        return;
    }

    $task = findTaskForMove($pdo, $taskId);
    if (!$task) {
        Response::error('Task not found.', 404);
        return;
    }

    normalizeSiblingSortOrder($pdo, $task['project_id'], $task['parent_id']);
    $siblings = listSiblingTasks($pdo, $task['project_id'], $task['parent_id']);
    $index = array_search($taskId, array_column($siblings, 'id'), true);
    if ($index === false) {
        Response::error('Task not found.', 404);
        return;
    }

    $targetIndex = $direction === 'up' ? $index - 1 : $index + 1;
    if (!array_key_exists($targetIndex, $siblings)) {
        listTasks($pdo, $request, $task['project_id']);
        return;
    }

    $current = $siblings[$index];
    $target = $siblings[$targetIndex];
    $stmt = $pdo->prepare(
        'UPDATE tasks SET sort_order = :sort_order, updated_by = :updated_by, updated_at = UTC_TIMESTAMP()
         WHERE id = :id AND deleted_at IS NULL',
    );
    $actor = $user['name'];
    $stmt->execute([':id' => $current['id'], ':sort_order' => $target['sort_order'], ':updated_by' => $actor]);
    $stmt->execute([':id' => $target['id'], ':sort_order' => $current['sort_order'], ':updated_by' => $actor]);

    TaskLog::create($pdo, $taskId, 'human', $actor, 'moved', $direction);
    emitProjectEvent(
        $pdo,
        $task['project_id'],
        $user['id'],
        'task.moved',
        'task',
        $taskId,
        'タスクの表示順が変更されました',
        ['direction' => $direction],
    );
    listTasks($pdo, $request, $task['project_id']);
}

function findTaskForMove(PDO $pdo, string $taskId): ?array
{
    $stmt = $pdo->prepare(
        'SELECT id, project_id, parent_id, sort_order
         FROM tasks
         WHERE id = :id AND deleted_at IS NULL',
    );
    $stmt->execute([':id' => $taskId]);
    $task = $stmt->fetch();

    return $task ?: null;
}

function listSiblingTasks(PDO $pdo, string $projectId, ?string $parentId): array
{
    if ($parentId === null) {
        $stmt = $pdo->prepare(
            'SELECT id, sort_order
             FROM tasks
             WHERE project_id = :project_id AND parent_id IS NULL AND deleted_at IS NULL
             ORDER BY sort_order, created_at, id',
        );
        $stmt->execute([':project_id' => $projectId]);
    } else {
        $stmt = $pdo->prepare(
            'SELECT id, sort_order
             FROM tasks
             WHERE project_id = :project_id AND parent_id = :parent_id AND deleted_at IS NULL
             ORDER BY sort_order, created_at, id',
        );
        $stmt->execute([':project_id' => $projectId, ':parent_id' => $parentId]);
    }

    return $stmt->fetchAll();
}

function normalizeSiblingSortOrder(PDO $pdo, string $projectId, ?string $parentId): void
{
    $siblings = listSiblingTasks($pdo, $projectId, $parentId);
    $stmt = $pdo->prepare('UPDATE tasks SET sort_order = :sort_order WHERE id = :id');
    foreach ($siblings as $index => $sibling) {
        $stmt->execute([
            ':id' => $sibling['id'],
            ':sort_order' => ($index + 1) * 10,
        ]);
    }
}

function deleteTask(PDO $pdo, Request $request, string $taskId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireTaskAccess($pdo, $taskId, $user['id']);
    $task = findTaskForMove($pdo, $taskId);
    if (!$task) {
        Response::error('Task not found.', 404);
        return;
    }

    $taskIds = collectTaskDescendantIds($pdo, $taskId);
    if ($taskIds === []) {
        Response::error('Task not found.', 404);
        return;
    }

    $placeholders = implode(', ', array_fill(0, count($taskIds), '?'));
    $stmt = $pdo->prepare(
        'UPDATE tasks SET deleted_at = UTC_TIMESTAMP(), updated_by = ?, updated_at = UTC_TIMESTAMP()
         WHERE id IN (' . $placeholders . ') AND deleted_at IS NULL',
    );
    $actor = $user['name'];
    $stmt->bindValue(1, $actor);
    $index = 2;
    foreach ($taskIds as $id) {
        $stmt->bindValue($index, $id);
        $index++;
    }
    $stmt->execute();

    TaskLog::create($pdo, $taskId, 'human', $actor, 'deleted', null);
    emitProjectEvent(
        $pdo,
        $task['project_id'],
        $user['id'],
        'task.deleted',
        'task',
        $taskId,
        'タスクが削除されました',
        ['deleted_task_ids' => $taskIds],
    );
    Response::json(['ok' => true, 'deleted_task_ids' => $taskIds]);
}

function collectTaskDescendantIds(PDO $pdo, string $taskId): array
{
    $stmt = $pdo->prepare('SELECT id FROM tasks WHERE id = :id AND deleted_at IS NULL');
    $stmt->execute([':id' => $taskId]);
    if (!$stmt->fetch()) {
        return [];
    }

    $ids = [$taskId];
    $queue = [$taskId];
    $children = $pdo->prepare('SELECT id FROM tasks WHERE parent_id = :parent_id AND deleted_at IS NULL');

    while ($queue !== []) {
        $current = array_shift($queue);
        $children->execute([':parent_id' => $current]);
        foreach ($children->fetchAll() as $row) {
            $ids[] = $row['id'];
            $queue[] = $row['id'];
        }
    }

    return $ids;
}

function listTaskLogs(PDO $pdo, Request $request, string $taskId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireTaskAccess($pdo, $taskId, $user['id']);

    $stmt = $pdo->prepare(
        'SELECT id, task_id, actor_type, actor_name, action, message, created_at
         FROM task_logs WHERE task_id = :task_id ORDER BY created_at DESC, id DESC',
    );
    $stmt->execute([':task_id' => $taskId]);
    Response::json(['logs' => $stmt->fetchAll()]);
}

function createTaskLog(PDO $pdo, Request $request, string $taskId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireTaskAccess($pdo, $taskId, $user['id']);

    $actorType = Validation::optionalEnum($request->body, 'actor_type', ['human', 'ai', 'system']) ?? 'human';
    $action = Validation::requireString($request->body, 'action');
    $logId = TaskLog::create($pdo, $taskId, $actorType, $user['name'], $action, $request->body['message'] ?? null);
    $task = findTaskForMove($pdo, $taskId);
    if ($task) {
        emitProjectEvent(
            $pdo,
            $task['project_id'],
            $user['id'],
            'task.log.created',
            'task_log',
            (string)$logId,
            '作業ログが追加されました',
            ['task_id' => $taskId],
        );
    }
    listTaskLogs($pdo, $request, $taskId);
}

function getGuestProject(PDO $pdo, string $guestToken): void
{
    $project = requireProjectGuestAccess($pdo, $guestToken);
    $stmt = $pdo->prepare(
        'SELECT id, project_id, parent_id, title, description, status, priority,
                assignee_type, assignee_name, start_date, due_date,
                estimate_hours, actual_hours, progress, acceptance_criteria,
                sort_order, gantt_color, created_at, updated_at
         FROM tasks
         WHERE project_id = :project_id AND deleted_at IS NULL
         ORDER BY COALESCE(parent_id, \'\'), sort_order, created_at',
    );
    $stmt->execute([':project_id' => $project['id']]);
    $tasks = array_map(static function (array $task): array {
        return [
            'id' => $task['id'],
            'project_id' => $task['project_id'],
            'parent_id' => $task['parent_id'],
            'title' => $task['title'],
            'description' => $task['description'],
            'status' => $task['status'],
            'priority' => $task['priority'],
            'assignee' => $task['assignee_name'] === null ? null : [
                'type' => $task['assignee_type'],
                'name' => $task['assignee_name'],
            ],
            'start_date' => $task['start_date'],
            'due_date' => $task['due_date'],
            'estimated_hours' => $task['estimate_hours'],
            'actual_hours' => $task['actual_hours'],
            'progress' => (int)$task['progress'],
            'acceptance_criteria' => $task['acceptance_criteria'],
            'order_index' => (int)$task['sort_order'],
            'gantt_color' => $task['gantt_color'],
            'created_at' => $task['created_at'],
            'updated_at' => $task['updated_at'],
        ];
    }, $stmt->fetchAll());

    Response::json(['project' => $project, 'tasks' => $tasks]);
}

function updateProjectGuestView(PDO $pdo, Request $request, string $projectId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireProjectWriteAccess($pdo, $projectId, $user['id']);
    if (!array_key_exists('enabled', $request->body) || !is_bool($request->body['enabled'])) {
        Response::error('Field enabled must be a boolean.', 422);
        return;
    }

    $enabled = $request->body['enabled'];
    if ($enabled) {
        $token = bin2hex(random_bytes(32));
        $stmt = $pdo->prepare(
            'UPDATE projects
             SET guest_view_enabled = 1,
                 guest_view_token = COALESCE(guest_view_token, :token),
                 guest_view_created_at = COALESCE(guest_view_created_at, UTC_TIMESTAMP()),
                 guest_view_updated_at = UTC_TIMESTAMP(),
                 updated_at = UTC_TIMESTAMP(),
                 updated_by = :updated_by
             WHERE id = :id AND deleted_at IS NULL',
        );
        $stmt->execute([':id' => $projectId, ':token' => $token, ':updated_by' => $user['name']]);
    } else {
        $stmt = $pdo->prepare(
            'UPDATE projects
             SET guest_view_enabled = 0,
                 guest_view_updated_at = UTC_TIMESTAMP(),
                 updated_at = UTC_TIMESTAMP(),
                 updated_by = :updated_by
             WHERE id = :id AND deleted_at IS NULL',
        );
        $stmt->execute([':id' => $projectId, ':updated_by' => $user['name']]);
    }

    emitProjectEvent(
        $pdo,
        $projectId,
        $user['id'],
        'guest_view.updated',
        'project',
        $projectId,
        $enabled ? 'ゲスト閲覧が有効になりました' : 'ゲスト閲覧が無効になりました',
        ['enabled' => $enabled],
    );
    getProject($pdo, $projectId);
}

function rotateProjectGuestView(PDO $pdo, Request $request, string $projectId): void
{
    $user = Auth::requireUser($pdo, $request);
    requireProjectWriteAccess($pdo, $projectId, $user['id']);
    $stmt = $pdo->prepare(
        'UPDATE projects
         SET guest_view_token = :token,
             guest_view_created_at = COALESCE(guest_view_created_at, UTC_TIMESTAMP()),
             guest_view_updated_at = UTC_TIMESTAMP(),
             updated_at = UTC_TIMESTAMP(),
             updated_by = :updated_by
         WHERE id = :id AND deleted_at IS NULL',
    );
    $stmt->execute([
        ':id' => $projectId,
        ':token' => bin2hex(random_bytes(32)),
        ':updated_by' => $user['name'],
    ]);
    emitProjectEvent(
        $pdo,
        $projectId,
        $user['id'],
        'guest_view.rotated',
        'project',
        $projectId,
        'ゲストURLが再生成されました',
    );
    getProject($pdo, $projectId);
}

function getAdminSetupStatus(PDO $pdo, array $config): void
{
    Response::json([
        'configured' => isAdminConfigured($pdo, $config),
        'config_file_enabled' => trim((string)($config['security']['admin_token'] ?? '')) !== '',
    ]);
}

function setupAdminToken(PDO $pdo, Request $request, array $config): void
{
    if (isAdminConfigured($pdo, $config)) {
        Response::error('Admin token is already configured.', 409);
        return;
    }

    $adminToken = Validation::requireString($request->body, 'admin_token');
    if (strlen($adminToken) < 12) {
        Response::error('Admin token must be at least 12 characters.', 422);
        return;
    }

    $stmt = $pdo->prepare(
        'INSERT INTO app_settings (setting_key, setting_value, updated_at)
         VALUES (:key, :value, UTC_TIMESTAMP())',
    );
    $stmt->execute([
        ':key' => 'admin_token_hash',
        ':value' => hash('sha256', $adminToken),
    ]);

    Response::json(['configured' => true], 201);
}

function isAdminConfigured(PDO $pdo, array $config): bool
{
    if (trim((string)($config['security']['admin_token'] ?? '')) !== '') {
        return true;
    }

    $stmt = $pdo->prepare('SELECT 1 FROM app_settings WHERE setting_key = :key LIMIT 1');
    $stmt->execute([':key' => 'admin_token_hash']);

    return (bool)$stmt->fetchColumn();
}

function listApiTokens(PDO $pdo, ?string $userId = null): void
{
    if ($userId === null) {
        $stmt = $pdo->query(
            'SELECT id, user_id, name, scopes, last_used_at, created_at, revoked_at
             FROM api_tokens ORDER BY created_at DESC, id DESC',
        );
    } else {
        $stmt = $pdo->prepare(
            'SELECT id, user_id, name, scopes, last_used_at, created_at, revoked_at
             FROM api_tokens
             WHERE user_id = :user_id
             ORDER BY created_at DESC, id DESC',
        );
        $stmt->execute([':user_id' => $userId]);
    }

    $tokens = array_map(static function (array $token): array {
        $token['scopes'] = $token['scopes'] ? json_decode((string)$token['scopes'], true) : [];
        if (!is_array($token['scopes'])) {
            $token['scopes'] = [];
        }
        return $token;
    }, $stmt->fetchAll());

    Response::json(['tokens' => $tokens]);
}

function createApiToken(PDO $pdo, Request $request, ?string $userId = null): void
{
    $name = Validation::requireString($request->body, 'name');
    $scopes = $request->body['scopes'] ?? ['agent'];
    if (!is_array($scopes)) {
        Response::error('Invalid scopes.', 422);
        return;
    }

    $plainToken = 'qwb_' . bin2hex(random_bytes(24));
    $hash = hash('sha256', $plainToken);
    $stmt = $pdo->prepare(
        'INSERT INTO api_tokens (user_id, name, token_hash, scopes, created_at)
         VALUES (:user_id, :name, :token_hash, :scopes, UTC_TIMESTAMP())',
    );
    $stmt->execute([
        ':user_id' => $userId,
        ':name' => $name,
        ':token_hash' => $hash,
        ':scopes' => json_encode(array_values($scopes), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);

    Response::json([
        'token' => [
            'id' => (int)$pdo->lastInsertId(),
            'name' => $name,
            'scopes' => array_values($scopes),
            'plain_token' => $plainToken,
        ],
    ], 201);
}

function revokeApiToken(PDO $pdo, int $tokenId, ?string $userId = null): void
{
    $sql = 'UPDATE api_tokens SET revoked_at = UTC_TIMESTAMP()
            WHERE id = :id AND revoked_at IS NULL';
    $params = [':id' => $tokenId];
    if ($userId !== null) {
        $sql .= ' AND user_id = :user_id';
        $params[':user_id'] = $userId;
    }
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    Response::json(['ok' => true, 'revoked' => $stmt->rowCount() > 0]);
}

function adminUserSelectSql(): string
{
    return 'SELECT users.id, users.email, users.name, users.avatar_color, users.avatar_image,
                   users.created_at, users.updated_at, users.suspended_until, users.disabled_at, users.deleted_at,
                   (SELECT COUNT(*) FROM user_sessions WHERE user_sessions.user_id = users.id) AS session_count,
                   (SELECT COUNT(*) FROM api_tokens WHERE api_tokens.user_id = users.id AND api_tokens.revoked_at IS NULL) AS api_token_count
            FROM users';
}

function listAdminUsers(PDO $pdo): void
{
    $stmt = $pdo->query(
        adminUserSelectSql() . '
         WHERE users.deleted_at IS NULL
         ORDER BY users.created_at DESC, users.id DESC',
    );
    Response::json(['users' => $stmt->fetchAll()]);
}

function getAdminUser(PDO $pdo, string $userId): void
{
    $stmt = $pdo->prepare(
        adminUserSelectSql() . '
         WHERE users.id = :id AND users.deleted_at IS NULL',
    );
    $stmt->execute([':id' => $userId]);
    $user = $stmt->fetch();
    if (!$user) {
        Response::error('User not found.', 404);
        return;
    }
    Response::json(['user' => $user]);
}

function clearUserSessionsAndTokens(PDO $pdo, string $userId, bool $revokeTokens = false): void
{
    $sessions = $pdo->prepare('DELETE FROM user_sessions WHERE user_id = :id');
    $sessions->execute([':id' => $userId]);
    if ($revokeTokens) {
        $tokens = $pdo->prepare('UPDATE api_tokens SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()) WHERE user_id = :id');
        $tokens->execute([':id' => $userId]);
    }
}

function updateAdminUserStatus(PDO $pdo, Request $request, string $userId): void
{
    $action = Validation::requireString($request->body, 'action');
    if ($action === 'suspend') {
        $days = (int)($request->body['days'] ?? 7);
        if ($days < 1 || $days > 365) {
            Response::error('Suspend days must be between 1 and 365.', 422);
            return;
        }
        $stmt = $pdo->prepare(
            'UPDATE users SET suspended_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ' . $days . ' DAY), updated_at = UTC_TIMESTAMP()
             WHERE id = :id AND deleted_at IS NULL',
        );
        $stmt->bindValue(':id', $userId);
        $stmt->execute();
        clearUserSessionsAndTokens($pdo, $userId);
    } elseif ($action === 'disable') {
        $stmt = $pdo->prepare(
            'UPDATE users SET disabled_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
             WHERE id = :id AND deleted_at IS NULL',
        );
        $stmt->execute([':id' => $userId]);
        clearUserSessionsAndTokens($pdo, $userId, true);
    } elseif ($action === 'activate') {
        $stmt = $pdo->prepare(
            'UPDATE users SET suspended_until = NULL, disabled_at = NULL, updated_at = UTC_TIMESTAMP()
             WHERE id = :id AND deleted_at IS NULL',
        );
        $stmt->execute([':id' => $userId]);
    } else {
        Response::error('Invalid action.', 422);
        return;
    }

    getAdminUser($pdo, $userId);
}

function resetUserPassword(PDO $pdo, Request $request, ?string $targetUserId = null): void
{
    $newPassword = Validation::requireString($request->body, 'new_password');
    if (strlen($newPassword) < 8) {
        Response::error('Password must be at least 8 characters.', 422);
        return;
    }

    $userId = $targetUserId;
    if ($userId === null) {
        $identifier = Validation::requireString($request->body, 'identifier');
        $userId = findUserIdByIdentifier($pdo, $identifier);
    }
    if ($userId === null) {
        Response::error('User not found.', 404);
        return;
    }

    $stmt = $pdo->prepare('UPDATE users SET password_hash = :hash, updated_at = UTC_TIMESTAMP() WHERE id = :id AND deleted_at IS NULL');
    $stmt->execute([
        ':id' => $userId,
        ':hash' => password_hash($newPassword, PASSWORD_DEFAULT),
    ]);
    clearUserSessionsAndTokens($pdo, $userId);
    Response::json(['ok' => true]);
}

function getAgentMe(PDO $pdo, Request $request, array $config): void
{
    $token = Auth::requireAgentToken($pdo, $request, $config);
    Response::json([
        'agent' => [
            'id' => $token['id'],
            'name' => $token['name'],
            'owner_user_id' => $token['user_id'] ?? null,
            'owner_name' => $token['owner_name'] ?? null,
            'actor_label' => formatAgentActorLabel($token),
            'scopes' => $token['scopes'],
            'last_used_at' => $token['last_used_at'],
        ],
    ]);
}

function getAgentDocs(PDO $pdo, Request $request, array $config): void
{
    $token = Auth::requireAgentToken($pdo, $request, $config);
    Response::json([
        'agent' => [
            'id' => $token['id'],
            'name' => $token['name'],
            'owner_user_id' => $token['user_id'] ?? null,
            'owner_name' => $token['owner_name'] ?? null,
            'actor_label' => formatAgentActorLabel($token),
            'scopes' => $token['scopes'],
            'last_used_at' => $token['last_used_at'],
        ],
        'documents' => [
            readAgentDoc('api', 'Quick WBS API', 'docs/api.md'),
            readAgentDoc('agent-guide', 'AI Agent Guide', 'docs/agent-guide.md'),
        ],
    ]);
}

function formatAgentActorLabel(array $token): string
{
    $name = trim((string)($token['name'] ?? ''));
    $ownerName = trim((string)($token['owner_name'] ?? ''));

    if ($ownerName !== '' && $name !== '') {
        return $ownerName . ' のAI (' . $name . ')';
    }
    if ($ownerName !== '') {
        return $ownerName . ' のAI';
    }
    if ($name !== '') {
        return $name;
    }

    return 'AI';
}

function readAgentDoc(string $id, string $title, string $relativePath): array
{
    $normalized = str_replace('\\', '/', $relativePath);
    $filename = basename($normalized);
    $candidates = [
        dirname(__DIR__, 2) . '/' . $normalized,
        dirname(__DIR__) . '/docs/' . $filename,
        __DIR__ . '/docs/' . $filename,
    ];

    $path = null;
    foreach ($candidates as $candidate) {
        if (is_file($candidate)) {
            $path = $candidate;
            break;
        }
    }

    if ($path === null) {
        Response::error('Agent documentation file not found.', 500);
        exit;
    }

    $content = file_get_contents($path);
    if ($content === false) {
        Response::error('Failed to read agent documentation.', 500);
        exit;
    }

    return [
        'id' => $id,
        'title' => $title,
        'path' => $relativePath,
        'content' => $content,
    ];
}

function listAvailableAgentTasks(PDO $pdo, ?string $userId): void
{
    $sql =
        "SELECT tasks.*, projects.name AS project_name
         FROM tasks
         INNER JOIN projects ON projects.id = tasks.project_id";
    $params = [];
    if ($userId !== null) {
        $sql .=
            ' LEFT JOIN user_groups ON user_groups.id = projects.group_id AND user_groups.deleted_at IS NULL
              LEFT JOIN group_members
                ON group_members.group_id = projects.group_id
               AND group_members.user_id = :member_user_id
               AND user_groups.id IS NOT NULL';
        $params[':member_user_id'] = $userId;
    }
    $sql .=
        " WHERE tasks.deleted_at IS NULL
           AND projects.deleted_at IS NULL
           AND tasks.status IN ('ready', 'todo')
           AND (tasks.assignee_type IS NULL OR tasks.assignee_type = 'ai')";
    if ($userId !== null) {
        $sql .= ' AND ((projects.group_id IS NULL AND projects.owner_user_id = :owner_user_id) OR group_members.user_id IS NOT NULL)';
        $params[':owner_user_id'] = $userId;
    }
    $sql .= ' ORDER BY tasks.priority DESC, tasks.due_date IS NULL, tasks.due_date, tasks.created_at LIMIT 50';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    Response::json(['tasks' => $stmt->fetchAll()]);
}

function getAgentTaskContext(PDO $pdo, string $taskId, ?string $userId): void
{
    if ($userId !== null) {
        requireTaskAccess($pdo, $taskId, $userId);
    }

    $stmt = $pdo->prepare(
        'SELECT tasks.*, projects.name AS project_name, projects.description AS project_description
         FROM tasks
         INNER JOIN projects ON projects.id = tasks.project_id
         WHERE tasks.id = :id AND tasks.deleted_at IS NULL AND projects.deleted_at IS NULL',
    );
    $stmt->execute([':id' => $taskId]);
    $task = $stmt->fetch();
    if (!$task) {
        Response::error('Task not found.', 404);
        return;
    }

    Response::json([
        'task' => $task,
        'ancestors' => taskAncestors($pdo, $task),
        'children' => taskChildren($pdo, $taskId),
        'logs' => recentTaskLogs($pdo, $taskId),
    ]);
}

function taskAncestors(PDO $pdo, array $task): array
{
    $ancestors = [];
    $parentId = $task['parent_id'];
    $stmt = $pdo->prepare(
        'SELECT id, parent_id, title, status, priority, due_date, acceptance_criteria
         FROM tasks WHERE id = :id AND deleted_at IS NULL',
    );

    while ($parentId !== null) {
        $stmt->execute([':id' => $parentId]);
        $parent = $stmt->fetch();
        if (!$parent) {
            break;
        }

        array_unshift($ancestors, $parent);
        $parentId = $parent['parent_id'];
    }

    return $ancestors;
}

function taskChildren(PDO $pdo, string $taskId): array
{
    $stmt = $pdo->prepare(
        'SELECT id, title, status, priority, assignee_type, assignee_name, due_date, progress, sort_order
         FROM tasks
         WHERE parent_id = :parent_id AND deleted_at IS NULL
         ORDER BY sort_order, created_at, id',
    );
    $stmt->execute([':parent_id' => $taskId]);

    return $stmt->fetchAll();
}

function recentTaskLogs(PDO $pdo, string $taskId): array
{
    $stmt = $pdo->prepare(
        'SELECT id, actor_type, actor_name, action, message, created_at
         FROM task_logs
         WHERE task_id = :task_id
         ORDER BY created_at DESC, id DESC
         LIMIT 10',
    );
    $stmt->execute([':task_id' => $taskId]);

    return $stmt->fetchAll();
}

function createAgentChildTask(PDO $pdo, Request $request, string $parentId, string $actorName, ?string $userId): void
{
    $stmt = $pdo->prepare('SELECT project_id FROM tasks WHERE id = :id AND deleted_at IS NULL');
    $stmt->execute([':id' => $parentId]);
    $parent = $stmt->fetch();
    if (!$parent) {
        Response::error('Parent task not found.', 404);
        return;
    }
    if ($userId !== null) {
        requireProjectWriteAccess($pdo, $parent['project_id'], $userId);
    }

    $id = now_id('task');
    $priority = Validation::optionalEnum($request->body, 'priority', Validation::PRIORITIES) ?? 'medium';
    $status = Validation::optionalEnum($request->body, 'status', Validation::STATUSES) ?? 'todo';

    $insert = $pdo->prepare(
        'INSERT INTO tasks (
            id, project_id, parent_id, title, description, status, priority, assignee_type,
            assignee_name, acceptance_criteria, start_date, due_date, estimate_hours,
            actual_hours, progress, sort_order, created_by, updated_by, created_at, updated_at
         ) VALUES (
            :id, :project_id, :parent_id, :title, :description, :status, :priority, "ai",
            :assignee_name, :acceptance_criteria, :start_date, :due_date, :estimate_hours,
            :actual_hours, :progress, :sort_order, :created_by, :updated_by, UTC_TIMESTAMP(), UTC_TIMESTAMP()
         )',
    );
    $insert->execute([
        ':id' => $id,
        ':project_id' => $parent['project_id'],
        ':parent_id' => $parentId,
        ':title' => Validation::requireString($request->body, 'title'),
        ':description' => $request->body['description'] ?? null,
        ':status' => $status,
        ':priority' => $priority,
        ':assignee_name' => $request->body['assignee_name'] ?? $actorName,
        ':acceptance_criteria' => $request->body['acceptance_criteria'] ?? null,
        ':start_date' => $request->body['start_date'] ?? null,
        ':due_date' => $request->body['due_date'] ?? null,
        ':estimate_hours' => $request->body['estimate_hours'] ?? null,
        ':actual_hours' => $request->body['actual_hours'] ?? null,
        ':progress' => Validation::progress($request->body),
        ':sort_order' => nextTaskSortOrder($pdo, $parent['project_id'], $parentId),
        ':created_by' => $actorName,
        ':updated_by' => $actorName,
    ]);

    TaskLog::create($pdo, $id, 'ai', $actorName, 'created', $request->body['message'] ?? null);
    TaskLog::create($pdo, $parentId, 'ai', $actorName, 'child_created', $id);
    emitProjectEvent(
        $pdo,
        $parent['project_id'],
        $userId,
        'task.created',
        'task',
        $id,
        'AIが子タスクを追加しました',
        ['parent_id' => $parentId],
    );
    getTask($pdo, $id, 201);
}

function updateAgentTask(PDO $pdo, Request $request, string $taskId, string $action, string $actorName, ?string $userId): void
{
    if ($userId !== null) {
        requireTaskAccess($pdo, $taskId, $userId);
    }
    $task = findTaskForMove($pdo, $taskId);
    if (!$task) {
        Response::error('Task not found.', 404);
        return;
    }

    $statusByAction = [
        'claim' => 'ready',
        'start' => 'in_progress',
        'block' => 'blocked',
        'complete' => 'done',
        'report' => null,
    ];
    $status = $statusByAction[$action];

    if ($status !== null) {
        $progress = $action === 'complete' ? 100 : Validation::progress($request->body);
        $stmt = $pdo->prepare(
            'UPDATE tasks
             SET status = :status, assignee_type = "ai", assignee_name = :actor_name,
                 progress = GREATEST(progress, :progress), updated_by = :updated_by, updated_at = UTC_TIMESTAMP()
             WHERE id = :id AND deleted_at IS NULL',
        );
        $stmt->execute([
            ':id' => $taskId,
            ':status' => $status,
            ':actor_name' => $actorName,
            ':progress' => $progress,
            ':updated_by' => $actorName,
        ]);
    }

    if ($action === 'report' && array_key_exists('progress', $request->body)) {
        $stmt = $pdo->prepare(
            'UPDATE tasks SET progress = GREATEST(progress, :progress), updated_by = :updated_by, updated_at = UTC_TIMESTAMP()
             WHERE id = :id AND deleted_at IS NULL',
        );
        $stmt->execute([
            ':id' => $taskId,
            ':progress' => Validation::progress($request->body),
            ':updated_by' => $actorName,
        ]);
    }

    $logId = TaskLog::create($pdo, $taskId, 'ai', $actorName, $action, formatAgentReportMessage($request->body));
    emitProjectEvent(
        $pdo,
        $task['project_id'],
        $userId,
        'task.updated',
        'task',
        $taskId,
        'AIがタスクを更新しました',
        ['action' => $action],
    );
    emitProjectEvent(
        $pdo,
        $task['project_id'],
        $userId,
        'task.log.created',
        'task_log',
        (string)$logId,
        'AIが作業ログを追加しました',
        ['task_id' => $taskId],
    );
    getTask($pdo, $taskId);
}

function formatAgentReportMessage(array $body): ?string
{
    $sections = [];
    foreach ([
        'message' => 'Message',
        'summary' => 'Summary',
        'work_notes' => 'Work notes',
        'result_url' => 'Result URL',
        'blockers' => 'Blockers',
    ] as $key => $label) {
        if (array_key_exists($key, $body) && trim((string)$body[$key]) !== '') {
            $sections[] = "{$label}: " . trim((string)$body[$key]);
        }
    }

    foreach ([
        'artifacts' => 'Artifacts',
        'next_actions' => 'Next actions',
    ] as $key => $label) {
        if (!array_key_exists($key, $body) || !is_array($body[$key]) || $body[$key] === []) {
            continue;
        }

        $items = array_values(array_filter(array_map(static fn ($item) => trim((string)$item), $body[$key])));
        if ($items !== []) {
            $sections[] = $label . ":\n- " . implode("\n- ", $items);
        }
    }

    return $sections === [] ? null : implode("\n\n", $sections);
}
