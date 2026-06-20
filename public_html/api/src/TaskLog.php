<?php

final class TaskLog
{
    public static function create(PDO $pdo, string $taskId, string $actorType, string $actorName, string $action, ?string $message = null): int
    {
        $stmt = $pdo->prepare(
            'INSERT INTO task_logs (task_id, actor_type, actor_name, action, message, created_at)
             VALUES (:task_id, :actor_type, :actor_name, :action, :message, UTC_TIMESTAMP())',
        );
        $stmt->execute([
            ':task_id' => $taskId,
            ':actor_type' => $actorType,
            ':actor_name' => $actorName,
            ':action' => $action,
            ':message' => $message,
        ]);
        return (int)$pdo->lastInsertId();
    }
}

