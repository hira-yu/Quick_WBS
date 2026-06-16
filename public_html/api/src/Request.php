<?php

final class Request
{
    public string $method;
    public string $path;
    public array $body;

    public function __construct()
    {
        $this->method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $this->path = self::normalizePath(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
        $this->body = self::readJsonBody();
    }

    public function actorName(): string
    {
        return trim($_SERVER['HTTP_X_ACTOR_NAME'] ?? '') ?: 'system';
    }

    public function bearerToken(): ?string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
            return null;
        }

        return trim($matches[1]);
    }

    public function userToken(): ?string
    {
        $token = trim($_SERVER['HTTP_X_USER_TOKEN'] ?? '');
        return $token === '' ? null : $token;
    }

    private static function normalizePath(string $path): string
    {
        $path = preg_replace('#/+#', '/', $path) ?: '/';
        $apiPos = strpos($path, '/api');
        if ($apiPos !== false) {
            $path = substr($path, $apiPos + 4) ?: '/';
        }

        return '/' . trim($path, '/');
    }

    private static function readJsonBody(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            Response::error('Invalid JSON body.', 400);
            exit;
        }

        return $decoded;
    }
}

