<?php

final class Auth
{
    public static function requireAgent(PDO $pdo, Request $request, array $config): string
    {
        if (($config['security']['require_agent_token'] ?? true) === false) {
            return $request->actorName();
        }

        $token = $request->bearerToken();
        if ($token === null || $token === '') {
            Response::error('Missing bearer token.', 401);
            exit;
        }

        $hash = hash('sha256', $token);
        $stmt = $pdo->prepare(
            'SELECT id, name FROM api_tokens WHERE token_hash = :hash AND revoked_at IS NULL',
        );
        $stmt->execute([':hash' => $hash]);
        $row = $stmt->fetch();
        if (!$row) {
            Response::error('Invalid bearer token.', 401);
            exit;
        }

        $update = $pdo->prepare('UPDATE api_tokens SET last_used_at = UTC_TIMESTAMP() WHERE id = :id');
        $update->execute([':id' => $row['id']]);

        return $row['name'];
    }
}

