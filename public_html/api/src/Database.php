<?php

final class Database
{
    public static function connect(array $config): PDO
    {
        $pdo = new PDO(
            $config['db']['dsn'],
            $config['db']['user'],
            $config['db']['password'],
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ],
        );

        $pdo->exec("SET time_zone = '+00:00'");
        return $pdo;
    }
}

