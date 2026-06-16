<?php

declare(strict_types=1);

require_once __DIR__ . '/src/Response.php';
require_once __DIR__ . '/src/Request.php';
require_once __DIR__ . '/src/Database.php';
require_once __DIR__ . '/src/Validation.php';
require_once __DIR__ . '/src/TaskLog.php';
require_once __DIR__ . '/src/Auth.php';
require_once __DIR__ . '/src/Support.php';

$configPath = __DIR__ . '/config/config.local.php';
if (!file_exists($configPath)) {
    $configPath = __DIR__ . '/config/config.example.php';
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

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS user_groups (
            id VARCHAR(32) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            created_by VARCHAR(32) NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            deleted_at DATETIME NULL,
            INDEX idx_groups_created_by (created_by)
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

    $stmt = $pdo->query("SHOW COLUMNS FROM projects LIKE 'group_id'");
    if (!$stmt->fetch()) {
        $pdo->exec('ALTER TABLE projects ADD COLUMN group_id VARCHAR(32) NULL AFTER description');
        $pdo->exec('CREATE INDEX idx_projects_group_updated ON projects(group_id, updated_at)');
    }
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

    if ($method === 'GET' && $path === '/projects') {
        listProjects($pdo, $request);
        return;
    }

    if ($method === 'POST' && $path === '/projects') {
        createProject($pdo, $request);
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

    if ($method === 'GET' && $path === '/agent/me') {
        getAgentMe($pdo, $request, $config);
        return;
    }

    if ($method === 'GET' && $path === '/agent/tasks/available') {
        Auth::requireAgent($pdo, $request, $config);
        listAvailableAgentTasks($pdo);
        return;
    }

    if ($method === 'GET' && preg_match('#^/agent/tasks/([^/]+)/context$#', $path, $m)) {
        Auth::requireAgent($pdo, $request, $config);
        getAgentTaskContext($pdo, $m[1]);
        return;
    }

    if ($method === 'POST' && preg_match('#^/agent/tasks/([^/]+)/children$#', $path, $m)) {
        $actorName = Auth::requireAgent($pdo, $request, $config);
        createAgentChildTask($pdo, $request, $m[1], $actorName);
        return;
    }

    if ($method === 'POST' && preg_match('#^/agent/tasks/([^/]+)/(claim|start|block|complete|report)$#', $path, $m)) {
        $actorName = Auth::requireAgent($pdo, $request, $config);
        updateAgentTask($pdo, $request, $m[1], $m[2], $actorName);
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
        'SELECT 1 FROM group_members
         INNER JOIN user_groups ON user_groups.id = group_members.group_id
         WHERE group_members.group_id = :group_id
           AND group_members.user_id = :user_id
           AND group_members.role = "owner"
           AND user_groups.deleted_at IS NULL',
    );
    $stmt->execute([':group_id' => $groupId, ':user_id' => $userId]);
    if (!$stmt->fetchColumn()) {
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
        $group = createOwnedGroup($pdo, $id, $name . 'のグループ');
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
        'groups' => [$group],
    ], 201);
}

function loginUser(PDO $pdo, Request $request): void
{
    $email = strtolower(Validation::requireString($request->body, 'email'));
    $password = Validation::requireString($request->body, 'password');

    $stmt = $pdo->prepare('SELECT id, email, name, avatar_color, avatar_image, password_hash FROM users WHERE email = :email AND deleted_at IS NULL');
    $stmt->execute([':email' => $email]);
    $user = $stmt->fetch();
    if (!$user || !password_verify($password, (string)$user['password_hash'])) {
        Response::error('Invalid email or password.', 401);
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

function listProjects(PDO $pdo, Request $request): void
{
    $user = Auth::optionalUser($pdo, $request);
    if ($user !== null) {
        $groupId = trim((string)($_GET['group_id'] ?? ''));
        $sql =
            'SELECT projects.id, projects.name, projects.description, projects.group_id,
                    projects.created_by, projects.updated_by, projects.created_at, projects.updated_at
             FROM projects
             LEFT JOIN group_members ON group_members.group_id = projects.group_id AND group_members.user_id = :user_id
             WHERE projects.deleted_at IS NULL
               AND (projects.group_id IS NULL OR group_members.user_id IS NOT NULL)';
        $params = [':user_id' => $user['id']];
        if ($groupId !== '') {
            requireGroupMember($pdo, $groupId, $user['id']);
            $sql .= ' AND projects.group_id = :group_id';
            $params[':group_id'] = $groupId;
        }
        $sql .= ' ORDER BY projects.updated_at DESC';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        Response::json(['projects' => $stmt->fetchAll()]);
        return;
    }

    $stmt = $pdo->query(
        'SELECT id, name, description, group_id, created_by, updated_by, created_at, updated_at
         FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC',
    );
    Response::json(['projects' => $stmt->fetchAll()]);
}

function createProject(PDO $pdo, Request $request): void
{
    $id = now_id('project');
    $name = Validation::requireString($request->body, 'name');
    $user = Auth::optionalUser($pdo, $request);
    $actor = $user['name'] ?? $request->actorName();
    $groupId = $request->body['group_id'] ?? null;
    if ($user !== null && $groupId !== null && $groupId !== '') {
        requireGroupMember($pdo, (string)$groupId, $user['id']);
    }

    $stmt = $pdo->prepare(
        'INSERT INTO projects (id, name, description, group_id, created_by, updated_by, created_at, updated_at)
         VALUES (:id, :name, :description, :group_id, :created_by, :updated_by, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
    );
    $stmt->execute([
        ':id' => $id,
        ':name' => $name,
        ':description' => $request->body['description'] ?? null,
        ':group_id' => $groupId ?: null,
        ':created_by' => $actor,
        ':updated_by' => $actor,
    ]);

    getProject($pdo, $id, 201);
}

function getProject(PDO $pdo, string $projectId, int $status = 200, ?Request $request = null): void
{
    if ($request !== null) {
        $user = Auth::optionalUser($pdo, $request);
        if ($user !== null) {
            requireProjectAccess($pdo, $projectId, $user['id']);
        }
    }

    $stmt = $pdo->prepare(
        'SELECT id, name, description, group_id, created_by, updated_by, created_at, updated_at
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
    $user = Auth::optionalUser($pdo, $request);
    if ($user !== null) {
        requireProjectAccess($pdo, $projectId, $user['id']);
    }

    $fields = pick($request->body, ['name', 'description', 'group_id']);
    if ($fields === []) {
        Response::error('No fields to update.', 422);
        return;
    }

    if ($user !== null && array_key_exists('group_id', $fields) && $fields['group_id']) {
        requireGroupMember($pdo, (string)$fields['group_id'], $user['id']);
    }

    $actor = $user['name'] ?? $request->actorName();
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
    getProject($pdo, $projectId);
}

function deleteProject(PDO $pdo, Request $request, string $projectId): void
{
    $user = Auth::optionalUser($pdo, $request);
    if ($user !== null) {
        requireProjectAccess($pdo, $projectId, $user['id']);
    }

    $stmt = $pdo->prepare(
        'UPDATE projects SET deleted_at = UTC_TIMESTAMP(), updated_by = :updated_by, updated_at = UTC_TIMESTAMP()
         WHERE id = :id AND deleted_at IS NULL',
    );
    $actor = $user['name'] ?? $request->actorName();
    $stmt->execute([':id' => $projectId, ':updated_by' => $actor]);
    Response::json(['ok' => true]);
}

function requireProjectAccess(PDO $pdo, string $projectId, string $userId): void
{
    $stmt = $pdo->prepare(
        'SELECT projects.id
         FROM projects
         LEFT JOIN group_members ON group_members.group_id = projects.group_id AND group_members.user_id = :user_id
         WHERE projects.id = :id
           AND projects.deleted_at IS NULL
           AND (projects.group_id IS NULL OR group_members.user_id IS NOT NULL)',
    );
    $stmt->execute([':id' => $projectId, ':user_id' => $userId]);
    if (!$stmt->fetchColumn()) {
        Response::error('Project not found.', 404);
        exit;
    }
}

function requireTaskAccess(PDO $pdo, string $taskId, string $userId): void
{
    $stmt = $pdo->prepare(
        'SELECT tasks.id
         FROM tasks
         INNER JOIN projects ON projects.id = tasks.project_id
         LEFT JOIN group_members ON group_members.group_id = projects.group_id AND group_members.user_id = :user_id
         WHERE tasks.id = :id
           AND tasks.deleted_at IS NULL
           AND projects.deleted_at IS NULL
           AND (projects.group_id IS NULL OR group_members.user_id IS NOT NULL)',
    );
    $stmt->execute([':id' => $taskId, ':user_id' => $userId]);
    if (!$stmt->fetchColumn()) {
        Response::error('Task not found.', 404);
        exit;
    }
}

function listTasks(PDO $pdo, Request $request, string $projectId): void
{
    $user = Auth::optionalUser($pdo, $request);
    if ($user !== null) {
        requireProjectAccess($pdo, $projectId, $user['id']);
    }

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
    $user = Auth::optionalUser($pdo, $request);
    if ($user !== null) {
        requireProjectAccess($pdo, $projectId, $user['id']);
    }

    $id = now_id('task');
    $actor = $user['name'] ?? $request->actorName();
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
    getTask($pdo, $id, 201);
}

function createChildTask(PDO $pdo, Request $request, string $parentId): void
{
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
        $user = Auth::optionalUser($pdo, $request);
        if ($user !== null) {
            requireTaskAccess($pdo, $taskId, $user['id']);
        }
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
    $user = Auth::optionalUser($pdo, $request);
    if ($user !== null) {
        requireTaskAccess($pdo, $taskId, $user['id']);
    }

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

    $actor = $user['name'] ?? $request->actorName();
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

    TaskLog::create($pdo, $taskId, 'human', $actor, 'updated', null);
    getTask($pdo, $taskId);
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
    $user = Auth::optionalUser($pdo, $request);
    if ($user !== null) {
        requireTaskAccess($pdo, $taskId, $user['id']);
    }

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
    $actor = $user['name'] ?? $request->actorName();
    $stmt->execute([':id' => $current['id'], ':sort_order' => $target['sort_order'], ':updated_by' => $actor]);
    $stmt->execute([':id' => $target['id'], ':sort_order' => $current['sort_order'], ':updated_by' => $actor]);

    TaskLog::create($pdo, $taskId, 'human', $actor, 'moved', $direction);
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
    $user = Auth::optionalUser($pdo, $request);
    if ($user !== null) {
        requireTaskAccess($pdo, $taskId, $user['id']);
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
    $actor = $user['name'] ?? $request->actorName();
    $stmt->bindValue(1, $actor);
    $index = 2;
    foreach ($taskIds as $id) {
        $stmt->bindValue($index, $id);
        $index++;
    }
    $stmt->execute();

    TaskLog::create($pdo, $taskId, 'human', $actor, 'deleted', null);
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
    $user = Auth::optionalUser($pdo, $request);
    if ($user !== null) {
        requireTaskAccess($pdo, $taskId, $user['id']);
    }

    $stmt = $pdo->prepare(
        'SELECT id, task_id, actor_type, actor_name, action, message, created_at
         FROM task_logs WHERE task_id = :task_id ORDER BY created_at DESC, id DESC',
    );
    $stmt->execute([':task_id' => $taskId]);
    Response::json(['logs' => $stmt->fetchAll()]);
}

function createTaskLog(PDO $pdo, Request $request, string $taskId): void
{
    $user = Auth::optionalUser($pdo, $request);
    if ($user !== null) {
        requireTaskAccess($pdo, $taskId, $user['id']);
    }

    $actorType = Validation::optionalEnum($request->body, 'actor_type', ['human', 'ai', 'system']) ?? 'human';
    $action = Validation::requireString($request->body, 'action');
    TaskLog::create($pdo, $taskId, $actorType, $user['name'] ?? $request->actorName(), $action, $request->body['message'] ?? null);
    listTaskLogs($pdo, $request, $taskId);
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

function listApiTokens(PDO $pdo): void
{
    $stmt = $pdo->query(
        'SELECT id, name, scopes, last_used_at, created_at, revoked_at
         FROM api_tokens ORDER BY created_at DESC, id DESC',
    );

    $tokens = array_map(static function (array $token): array {
        $token['scopes'] = $token['scopes'] ? json_decode((string)$token['scopes'], true) : [];
        if (!is_array($token['scopes'])) {
            $token['scopes'] = [];
        }
        return $token;
    }, $stmt->fetchAll());

    Response::json(['tokens' => $tokens]);
}

function createApiToken(PDO $pdo, Request $request): void
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
        'INSERT INTO api_tokens (name, token_hash, scopes, created_at)
         VALUES (:name, :token_hash, :scopes, UTC_TIMESTAMP())',
    );
    $stmt->execute([
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

function revokeApiToken(PDO $pdo, int $tokenId): void
{
    $stmt = $pdo->prepare(
        'UPDATE api_tokens SET revoked_at = UTC_TIMESTAMP()
         WHERE id = :id AND revoked_at IS NULL',
    );
    $stmt->execute([':id' => $tokenId]);
    Response::json(['ok' => true, 'revoked' => $stmt->rowCount() > 0]);
}

function resetUserPassword(PDO $pdo, Request $request): void
{
    $identifier = Validation::requireString($request->body, 'identifier');
    $newPassword = Validation::requireString($request->body, 'new_password');
    if (strlen($newPassword) < 8) {
        Response::error('Password must be at least 8 characters.', 422);
        return;
    }

    $userId = findUserIdByIdentifier($pdo, $identifier);
    if ($userId === null) {
        Response::error('User not found.', 404);
        return;
    }

    $stmt = $pdo->prepare('UPDATE users SET password_hash = :hash, updated_at = UTC_TIMESTAMP() WHERE id = :id AND deleted_at IS NULL');
    $stmt->execute([
        ':id' => $userId,
        ':hash' => password_hash($newPassword, PASSWORD_DEFAULT),
    ]);
    Response::json(['ok' => true]);
}

function getAgentMe(PDO $pdo, Request $request, array $config): void
{
    $token = Auth::requireAgentToken($pdo, $request, $config);
    Response::json([
        'agent' => [
            'id' => $token['id'],
            'name' => $token['name'],
            'scopes' => $token['scopes'],
            'last_used_at' => $token['last_used_at'],
        ],
    ]);
}

function listAvailableAgentTasks(PDO $pdo): void
{
    $stmt = $pdo->query(
        "SELECT tasks.*, projects.name AS project_name
         FROM tasks
         INNER JOIN projects ON projects.id = tasks.project_id
         WHERE tasks.deleted_at IS NULL
           AND projects.deleted_at IS NULL
           AND tasks.status IN ('ready', 'todo')
           AND (tasks.assignee_type IS NULL OR tasks.assignee_type = 'ai')
         ORDER BY tasks.priority DESC, tasks.due_date IS NULL, tasks.due_date, tasks.created_at
         LIMIT 50",
    );
    Response::json(['tasks' => $stmt->fetchAll()]);
}

function getAgentTaskContext(PDO $pdo, string $taskId): void
{
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

function createAgentChildTask(PDO $pdo, Request $request, string $parentId, string $actorName): void
{
    $stmt = $pdo->prepare('SELECT project_id FROM tasks WHERE id = :id AND deleted_at IS NULL');
    $stmt->execute([':id' => $parentId]);
    $parent = $stmt->fetch();
    if (!$parent) {
        Response::error('Parent task not found.', 404);
        return;
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
    getTask($pdo, $id, 201);
}

function updateAgentTask(PDO $pdo, Request $request, string $taskId, string $action, string $actorName): void
{
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

    TaskLog::create($pdo, $taskId, 'ai', $actorName, $action, formatAgentReportMessage($request->body));
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
