<?php

final class Response
{
    public static function json(mixed $payload, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('Pragma: no-cache');
        header('Expires: 0');
        header('Last-Modified: ' . gmdate('D, d M Y H:i:s') . ' GMT');
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    public static function error(string $message, int $status = 400, array $details = []): void
    {
        self::json([
            'error' => [
                'message' => $message,
                'details' => $details,
            ],
        ], $status);
    }
}

