<?php

function now_id(string $prefix): string
{
    return $prefix . '_' . bin2hex(random_bytes(8));
}

function pick(array $data, array $keys): array
{
    $picked = [];
    foreach ($keys as $key) {
        if (array_key_exists($key, $data)) {
            $picked[$key] = $data[$key];
        }
    }

    return $picked;
}

