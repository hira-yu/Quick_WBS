<?php

final class Auth
{
    public static function requireAgent(PDO $pdo, Request $request, array $config): string
    {
        return self::requireAgentToken($pdo, $request, $config)['name'];
    }

    public static function requireAgentToken(PDO $pdo, Request $request, array $config): array
    {
        if (($config['security']['require_agent_token'] ?? true) === false) {
            return [
                'id' => null,
                'name' => $request->actorName(),
                'scopes' => [],
                'last_used_at' => null,
            ];
        }

        $token = $request->bearerToken();
        if ($token === null || $token === '') {
            Response::error('Missing bearer token.', 401);
            exit;
        }

        $hash = hash('sha256', $token);
        $stmt = $pdo->prepare(
            'SELECT id, name, scopes, last_used_at FROM api_tokens WHERE token_hash = :hash AND revoked_at IS NULL',
        );
        $stmt->execute([':hash' => $hash]);
        $row = $stmt->fetch();
        if (!$row) {
            Response::error('Invalid bearer token.', 401);
            exit;
        }

        $update = $pdo->prepare('UPDATE api_tokens SET last_used_at = UTC_TIMESTAMP() WHERE id = :id');
        $update->execute([':id' => $row['id']]);

        $row['scopes'] = $row['scopes'] ? json_decode((string)$row['scopes'], true) : [];
        if (!is_array($row['scopes'])) {
            $row['scopes'] = [];
        }

        return $row;
    }

    public static function requireAdmin(PDO $pdo, Request $request, array $config): void
    {
        $provided = trim($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
        if ($provided === '') {
            Response::error('Invalid admin token.', 401);
            exit;
        }

        $expected = trim((string)($config['security']['admin_token'] ?? ''));
        if ($expected !== '' && hash_equals($expected, $provided)) {
            return;
        }

        $stmt = $pdo->prepare('SELECT setting_value FROM app_settings WHERE setting_key = :key');
        $stmt->execute([':key' => 'admin_token_hash']);
        $row = $stmt->fetch();
        if (!$row) {
            Response::error('Admin token is not configured.', 503);
            exit;
        }

        $hash = hash('sha256', $provided);
        if (!hash_equals((string)$row['setting_value'], $hash)) {
            Response::error('Invalid admin token.', 401);
            exit;
        }
    }
}
