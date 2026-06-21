<?php

declare(strict_types=1);

$apiBase = rtrim($argv[1] ?? 'http://127.0.0.1:8081/api', '/');
$webBase = rtrim($argv[2] ?? 'http://127.0.0.1:8081', '/');
$suffix = bin2hex(random_bytes(5));
$results = [];

function httpRequest(string $method, string $url, ?array $body = null, array $headers = []): array
{
    $headerLines = [];
    $hasAcceptHeader = false;
    foreach ($headers as $name => $value) {
        $headerLines[] = $name . ': ' . $value;
        if (strtolower($name) === 'accept') {
            $hasAcceptHeader = true;
        }
    }
    if (!$hasAcceptHeader) {
        $headerLines[] = 'Accept: application/json';
    }
    $content = '';
    if ($body !== null) {
        $content = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $headerLines[] = 'Content-Type: application/json';
    }

    $context = stream_context_create([
        'http' => [
            'method' => $method,
            'header' => implode("\r\n", $headerLines),
            'content' => $content,
            'ignore_errors' => true,
            'timeout' => 15,
        ],
    ]);
    $raw = file_get_contents($url, false, $context);
    $responseHeaders = $http_response_header ?? [];
    $status = 0;
    if (isset($responseHeaders[0]) && preg_match('/\s(\d{3})\s/', $responseHeaders[0], $match)) {
        $status = (int)$match[1];
    }
    $decoded = is_string($raw) ? json_decode($raw, true) : null;

    return [
        'status' => $status,
        'body' => is_array($decoded) ? $decoded : null,
        'raw' => is_string($raw) ? $raw : '',
        'headers' => $responseHeaders,
    ];
}

function expectStatus(string $label, array $response, int $expected): array
{
    if ($response['status'] !== $expected) {
        $message = $response['body']['error']['message'] ?? substr($response['raw'], 0, 300);
        throw new RuntimeException("{$label}: expected {$expected}, got {$response['status']} ({$message})");
    }
    return $response;
}

function expectTrue(string $label, bool $condition): void
{
    if (!$condition) {
        throw new RuntimeException($label);
    }
}

function responseHeader(array $response, string $name): ?string
{
    foreach ($response['headers'] as $header) {
        if (stripos($header, $name . ':') === 0) {
            return trim(substr($header, strlen($name) + 1));
        }
    }
    return null;
}

function runCheck(string $label, callable $check): void
{
    global $results;
    try {
        $check();
        $results[] = ['label' => $label, 'ok' => true, 'message' => ''];
        echo "[PASS] {$label}\n";
    } catch (Throwable $error) {
        $results[] = ['label' => $label, 'ok' => false, 'message' => $error->getMessage()];
        echo "[FAIL] {$label}: {$error->getMessage()}\n";
    }
}

function userHeaders(string $token): array
{
    return ['X-User-Token' => $token, 'X-Actor-Name' => 'http-integration-test'];
}

$ownerEmail = "owner-{$suffix}@example.test";
$memberEmail = "member-{$suffix}@example.test";

$owner = expectStatus(
    'register owner',
    httpRequest('POST', "{$apiBase}/auth/register", [
        'name' => "owner-{$suffix}",
        'email' => $ownerEmail,
        'password' => 'Test-password-123!',
    ]),
    201,
)['body'];
$member = expectStatus(
    'register member',
    httpRequest('POST', "{$apiBase}/auth/register", [
        'name' => "member-{$suffix}",
        'email' => $memberEmail,
        'password' => 'Test-password-123!',
    ]),
    201,
)['body'];
$ownerToken = $owner['token'];
$memberToken = $member['token'];

runCheck('JSON responses disable caching', function () use ($apiBase, $ownerToken): void {
    $response = expectStatus('projects cache headers', httpRequest('GET', "{$apiBase}/projects", null, userHeaders($ownerToken)), 200);
    expectTrue(
        'Cache-Control is not no-store',
        responseHeader($response, 'Cache-Control') === 'no-store, no-cache, must-revalidate, max-age=0',
    );
    expectTrue('Pragma is not no-cache', responseHeader($response, 'Pragma') === 'no-cache');
    expectTrue('Expires is not zero', responseHeader($response, 'Expires') === '0');
    expectTrue('Last-Modified is missing', responseHeader($response, 'Last-Modified') !== null);
});

runCheck('1. unauthenticated normal APIs return 401', function () use ($apiBase): void {
    $requests = [
        ['GET', '/projects', null],
        ['POST', '/projects', ['name' => 'unauthorized']],
        ['GET', '/projects/missing', null],
        ['GET', '/projects/missing/events', null],
        ['PATCH', '/projects/missing', ['name' => 'unauthorized']],
        ['DELETE', '/projects/missing', null],
        ['GET', '/projects/missing/tasks', null],
        ['POST', '/projects/missing/tasks', ['title' => 'unauthorized']],
        ['GET', '/groups', null],
        ['POST', '/groups', ['name' => 'unauthorized']],
        ['GET', '/groups/missing/members', null],
        ['POST', '/groups/missing/members', ['identifier' => 'nobody@example.test']],
        ['GET', '/tasks/missing', null],
        ['PATCH', '/tasks/missing', ['progress' => 1]],
        ['DELETE', '/tasks/missing', null],
        ['POST', '/tasks/missing/children', ['title' => 'unauthorized']],
        ['POST', '/tasks/missing/move', ['direction' => 'up']],
        ['GET', '/tasks/missing/logs', null],
        ['POST', '/tasks/missing/logs', ['action' => 'report']],
    ];
    foreach ($requests as [$method, $path, $body]) {
        expectStatus("{$method} {$path}", httpRequest($method, $apiBase . $path, $body), 401);
    }
});

$personalProject = null;
$personalTask = null;
runCheck('2. authenticated owner project/task CRUD works', function () use ($apiBase, $ownerToken, &$personalProject, &$personalTask): void {
    $headers = userHeaders($ownerToken);
    $personalProject = expectStatus(
        'create personal project',
        httpRequest('POST', "{$apiBase}/projects", ['name' => 'Personal integration project'], $headers),
        201,
    )['body']['project'];
    expectStatus('get project', httpRequest('GET', "{$apiBase}/projects/{$personalProject['id']}", null, $headers), 200);
    $updated = expectStatus(
        'update project',
        httpRequest('PATCH', "{$apiBase}/projects/{$personalProject['id']}", ['description' => 'updated'], $headers),
        200,
    )['body']['project'];
    expectTrue('project description was not updated', $updated['description'] === 'updated');
    $personalTask = expectStatus(
        'create task',
        httpRequest('POST', "{$apiBase}/projects/{$personalProject['id']}/tasks", ['title' => 'Personal task'], $headers),
        201,
    )['body']['task'];
    expectStatus('list tasks', httpRequest('GET', "{$apiBase}/projects/{$personalProject['id']}/tasks", null, $headers), 200);
    expectStatus('update task', httpRequest('PATCH', "{$apiBase}/tasks/{$personalTask['id']}", ['progress' => 40], $headers), 200);
    expectStatus(
        'create work log',
        httpRequest('POST', "{$apiBase}/tasks/{$personalTask['id']}/logs", ['action' => 'report', 'message' => 'integration'], $headers),
        200,
    );
    expectStatus('list work logs', httpRequest('GET', "{$apiBase}/tasks/{$personalTask['id']}/logs", null, $headers), 200);
});

runCheck('3. project events return task changes since the requested event', function () use ($apiBase, $ownerToken, $memberToken, $personalProject): void {
    $headers = userHeaders($ownerToken);
    $eventsUrl = "{$apiBase}/projects/{$personalProject['id']}/events";
    $baseline = expectStatus('event baseline', httpRequest('GET', $eventsUrl, null, $headers), 200)['body'];
    expectTrue('baseline unexpectedly returned event rows', ($baseline['events'] ?? null) === []);
    $since = (int)($baseline['latest_event_id'] ?? 0);

    $task = expectStatus(
        'create event task',
        httpRequest('POST', "{$apiBase}/projects/{$personalProject['id']}/tasks", ['title' => 'Event task'], $headers),
        201,
    )['body']['task'];
    $created = expectStatus('created event diff', httpRequest('GET', "{$eventsUrl}?since={$since}", null, $headers), 200)['body'];
    expectTrue(
        'task.created event missing',
        count(array_filter(
            $created['events'] ?? [],
            static fn(array $event): bool => $event['event_type'] === 'task.created' && $event['target_id'] === $task['id'],
        )) === 1,
    );
    $since = (int)$created['latest_event_id'];

    expectStatus(
        'update event task',
        httpRequest('PATCH', "{$apiBase}/tasks/{$task['id']}", ['progress' => 65], $headers),
        200,
    );
    $updated = expectStatus('updated event diff', httpRequest('GET', "{$eventsUrl}?since={$since}", null, $headers), 200)['body'];
    expectTrue(
        'task.updated event missing',
        count(array_filter(
            $updated['events'] ?? [],
            static fn(array $event): bool => $event['event_type'] === 'task.updated' && $event['target_id'] === $task['id'],
        )) === 1,
    );
    expectTrue(
        'since returned an older event',
        count(array_filter(
            $updated['events'] ?? [],
            static fn(array $event): bool => (int)$event['id'] <= $since,
        )) === 0,
    );
    $since = (int)$updated['latest_event_id'];

    expectStatus('delete event task', httpRequest('DELETE', "{$apiBase}/tasks/{$task['id']}", null, $headers), 200);
    $deleted = expectStatus('deleted event diff', httpRequest('GET', "{$eventsUrl}?since={$since}", null, $headers), 200)['body'];
    expectTrue(
        'task.deleted event missing',
        count(array_filter(
            $deleted['events'] ?? [],
            static fn(array $event): bool => $event['event_type'] === 'task.deleted' && $event['target_id'] === $task['id'],
        )) === 1,
    );

    expectStatus(
        'unauthorized user project events',
        httpRequest('GET', $eventsUrl, null, userHeaders($memberToken)),
        404,
    );
});

$activeGroup = expectStatus(
    'create active group',
    httpRequest('POST', "{$apiBase}/groups", ['name' => "active-{$suffix}"], userHeaders($ownerToken)),
    201,
)['body']['group'];
expectStatus(
    'add group member',
    httpRequest('POST', "{$apiBase}/groups/{$activeGroup['id']}/members", ['identifier' => $memberEmail], userHeaders($ownerToken)),
    200,
);
$sharedProject = expectStatus(
    'create group project',
    httpRequest('POST', "{$apiBase}/projects", ['name' => 'Shared integration project', 'group_id' => $activeGroup['id']], userHeaders($ownerToken)),
    201,
)['body']['project'];
$sharedTask = expectStatus(
    'create shared task',
    httpRequest('POST', "{$apiBase}/projects/{$sharedProject['id']}/tasks", ['title' => 'Shared task'], userHeaders($ownerToken)),
    201,
)['body']['task'];

runCheck('4. group member can read and operate shared project', function () use ($apiBase, $memberToken, $activeGroup, $sharedProject, $sharedTask): void {
    $headers = userHeaders($memberToken);
    $projects = expectStatus(
        'member lists group projects',
        httpRequest('GET', "{$apiBase}/projects?group_id={$activeGroup['id']}", null, $headers),
        200,
    )['body']['projects'];
    expectTrue('shared project was not listed for member', in_array($sharedProject['id'], array_column($projects, 'id'), true));
    expectStatus('member reads project', httpRequest('GET', "{$apiBase}/projects/{$sharedProject['id']}", null, $headers), 200);
    expectStatus('member updates project', httpRequest('PATCH', "{$apiBase}/projects/{$sharedProject['id']}", ['description' => 'member update'], $headers), 200);
    expectStatus('member creates task', httpRequest('POST', "{$apiBase}/projects/{$sharedProject['id']}/tasks", ['title' => 'Member task'], $headers), 201);
    expectStatus('member updates task', httpRequest('PATCH', "{$apiBase}/tasks/{$sharedTask['id']}", ['progress' => 55], $headers), 200);
});

$guestProject = expectStatus(
    'enable guest view',
    httpRequest('PATCH', "{$apiBase}/projects/{$sharedProject['id']}/guest-view", ['enabled' => true], userHeaders($ownerToken)),
    200,
)['body']['project'];
$guestToken = $guestProject['guest_view_token'];
$guestUrl = "{$apiBase}/guest/projects/{$guestToken}";

runCheck('5. enabled guest URL opens without login', function () use ($guestUrl): void {
    $guest = expectStatus('guest project API', httpRequest('GET', $guestUrl), 200)['body'];
    expectTrue('guest response contains no project owner permission fields', !isset($guest['project']['owner_user_id']));
    expectTrue('guest response contains no email', !str_contains(json_encode($guest), '@example.test'));
    expectTrue('guest response contains tasks', count($guest['tasks'] ?? []) > 0);
});

runCheck('6. guest events expose changes without private event fields', function () use ($apiBase, $ownerToken, $guestUrl, $sharedTask): void {
    $baseline = expectStatus('guest event baseline', httpRequest('GET', "{$guestUrl}/events"), 200)['body'];
    $since = (int)($baseline['latest_event_id'] ?? 0);
    expectStatus(
        'update task visible to guest',
        httpRequest('PATCH', "{$apiBase}/tasks/{$sharedTask['id']}", ['progress' => 56], userHeaders($ownerToken)),
        200,
    );
    $diff = expectStatus('guest event diff', httpRequest('GET', "{$guestUrl}/events?since={$since}"), 200)['body'];
    expectTrue(
        'guest task.updated event missing',
        count(array_filter(
            $diff['events'] ?? [],
            static fn(array $event): bool => $event['event_type'] === 'task.updated' && $event['target_id'] === $sharedTask['id'],
        )) === 1,
    );
    foreach ($diff['events'] ?? [] as $event) {
        expectTrue('guest event exposed actor_user_id', !array_key_exists('actor_user_id', $event));
        expectTrue('guest event exposed payload', !array_key_exists('payload', $event));
    }
});

runCheck('7. guest access is read-only and has no agent authority', function () use ($apiBase, $guestToken, $sharedTask): void {
    $guestHeader = ['X-Guest-Token' => $guestToken];
    expectStatus('guest task update', httpRequest('PATCH', "{$apiBase}/tasks/{$sharedTask['id']}", ['progress' => 99], $guestHeader), 401);
    expectStatus('guest task delete', httpRequest('DELETE', "{$apiBase}/tasks/{$sharedTask['id']}", null, $guestHeader), 401);
    expectStatus('guest work log create', httpRequest('POST', "{$apiBase}/tasks/{$sharedTask['id']}/logs", ['action' => 'report'], $guestHeader), 401);
    expectStatus('guest agent action', httpRequest('POST', "{$apiBase}/agent/tasks/{$sharedTask['id']}/start", [], $guestHeader), 401);
});

runCheck('8. disabled guest URL and event feed return 404', function () use ($apiBase, $ownerToken, $sharedProject, $guestUrl): void {
    expectStatus(
        'disable guest view',
        httpRequest('PATCH', "{$apiBase}/projects/{$sharedProject['id']}/guest-view", ['enabled' => false], userHeaders($ownerToken)),
        200,
    );
    expectStatus('disabled guest URL', httpRequest('GET', $guestUrl), 404);
    expectStatus('disabled guest event feed', httpRequest('GET', "{$guestUrl}/events"), 404);
});

$reenabled = expectStatus(
    're-enable guest view',
    httpRequest('PATCH', "{$apiBase}/projects/{$sharedProject['id']}/guest-view", ['enabled' => true], userHeaders($ownerToken)),
    200,
)['body']['project'];
$oldToken = $reenabled['guest_view_token'];
$rotated = expectStatus(
    'rotate guest token',
    httpRequest('POST', "{$apiBase}/projects/{$sharedProject['id']}/guest-view/rotate", [], userHeaders($ownerToken)),
    200,
)['body']['project'];
$newToken = $rotated['guest_view_token'];

runCheck('9. rotated old URL is 404 and new URL is 200', function () use ($apiBase, $oldToken, $newToken): void {
    expectTrue('guest token did not change', $oldToken !== $newToken);
    expectStatus('old guest URL', httpRequest('GET', "{$apiBase}/guest/projects/{$oldToken}"), 404);
    expectStatus('new guest URL', httpRequest('GET', "{$apiBase}/guest/projects/{$newToken}"), 200);
});

$emptyGroup = expectStatus(
    'create empty group',
    httpRequest('POST', "{$apiBase}/groups", ['name' => "empty-{$suffix}"], userHeaders($ownerToken)),
    201,
)['body']['group'];
expectStatus(
    'add member to empty group',
    httpRequest('POST', "{$apiBase}/groups/{$emptyGroup['id']}/members", ['identifier' => $memberEmail], userHeaders($ownerToken)),
    200,
);

runCheck('10. only group owner can delete group', function () use ($apiBase, $ownerToken, $memberToken, $emptyGroup): void {
    expectStatus('member group delete', httpRequest('DELETE', "{$apiBase}/groups/{$emptyGroup['id']}", null, userHeaders($memberToken)), 403);
    expectStatus('owner group delete', httpRequest('DELETE', "{$apiBase}/groups/{$emptyGroup['id']}", null, userHeaders($ownerToken)), 200);
});

runCheck('11. group with active project returns 409', function () use ($apiBase, $ownerToken, $activeGroup): void {
    $response = expectStatus(
        'active group delete',
        httpRequest('DELETE', "{$apiBase}/groups/{$activeGroup['id']}", null, userHeaders($ownerToken)),
        409,
    );
    expectTrue(
        'unexpected 409 message',
        ($response['body']['error']['message'] ?? '') === 'Group has active projects. Move or delete projects before deleting the group.',
    );
});

expectStatus('delete shared project', httpRequest('DELETE', "{$apiBase}/projects/{$sharedProject['id']}", null, userHeaders($ownerToken)), 200);
expectStatus('delete formerly active group', httpRequest('DELETE', "{$apiBase}/groups/{$activeGroup['id']}", null, userHeaders($ownerToken)), 200);

runCheck('12. deleted groups are excluded from lists and access checks', function () use ($apiBase, $ownerToken, $memberToken, $activeGroup, $emptyGroup): void {
    foreach ([[$ownerToken, $activeGroup['id']], [$memberToken, $activeGroup['id']], [$ownerToken, $emptyGroup['id']]] as [$token, $groupId]) {
        $groups = expectStatus('list groups', httpRequest('GET', "{$apiBase}/groups", null, userHeaders($token)), 200)['body']['groups'];
        expectTrue("deleted group {$groupId} remained in list", !in_array($groupId, array_column($groups, 'id'), true));
    }
    expectStatus(
        'deleted group member access',
        httpRequest('GET', "{$apiBase}/groups/{$activeGroup['id']}/members", null, userHeaders($memberToken)),
        404,
    );
    expectStatus(
        'create project in deleted group',
        httpRequest('POST', "{$apiBase}/projects", ['name' => 'must fail', 'group_id' => $activeGroup['id']], userHeaders($ownerToken)),
        404,
    );
});

runCheck('SPA guest route returns index.html on direct access', function () use ($webBase, $newToken): void {
    $url = "{$webBase}/guest/projects/{$newToken}";
    $response = httpRequest('GET', $url, null, ['Accept' => 'text/html']);
    expectTrue(
        'guest SPA direct URL: expected 200, got ' . $response['status'] . ' from ' . $url . ' (' . implode(' | ', $response['headers']) . ')',
        $response['status'] === 200,
    );
    expectTrue('guest SPA did not return the React entry document', str_contains($response['raw'], '<div id="root"></div>'));
});

if ($personalProject !== null) {
    expectStatus('delete personal project', httpRequest('DELETE', "{$apiBase}/projects/{$personalProject['id']}", null, userHeaders($ownerToken)), 200);
    expectStatus('deleted personal project is gone', httpRequest('GET', "{$apiBase}/projects/{$personalProject['id']}", null, userHeaders($ownerToken)), 404);
}

$failed = array_values(array_filter($results, static fn(array $result): bool => !$result['ok']));
echo "\n" . count($results) . ' checks, ' . count($failed) . " failures\n";
exit($failed === [] ? 0 : 1);
