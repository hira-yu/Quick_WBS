<?php

final class Validation
{
    public const STATUSES = ['todo', 'ready', 'in_progress', 'blocked', 'review', 'done'];
    public const PRIORITIES = ['low', 'medium', 'high', 'critical'];
    public const ASSIGNEE_TYPES = ['human', 'ai'];

    public static function requireString(array $data, string $key): string
    {
        $value = trim((string)($data[$key] ?? ''));
        if ($value === '') {
            Response::error("Missing required field: {$key}", 422);
            exit;
        }

        return $value;
    }

    public static function optionalEnum(array $data, string $key, array $allowed): ?string
    {
        if (!array_key_exists($key, $data) || $data[$key] === null || $data[$key] === '') {
            return null;
        }

        $value = (string)$data[$key];
        if (!in_array($value, $allowed, true)) {
            Response::error("Invalid {$key}.", 422, ['allowed' => $allowed]);
            exit;
        }

        return $value;
    }

    public static function progress(array $data, string $key = 'progress'): int
    {
        $value = (int)($data[$key] ?? 0);
        return max(0, min(100, $value));
    }

    public static function color(array $data, string $key): ?string
    {
        if (!array_key_exists($key, $data) || $data[$key] === null || $data[$key] === '') {
            return null;
        }

        $value = (string)$data[$key];
        if (!preg_match('/^#[0-9a-fA-F]{6}$/', $value)) {
            Response::error("Invalid {$key}.", 422, ['format' => '#RRGGBB']);
            exit;
        }

        return strtolower($value);
    }
}
