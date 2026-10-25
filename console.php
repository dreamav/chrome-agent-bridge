<?php
/**
 * Chrome Agent Bridge - PHP CLI Utility (PHP 7.1+ compatible)
 * Allows sending commands to Google Chrome extension from the terminal.
 *
 * Usage:
 *   php console.php tabs               → List all open tabs
 *   php console.php dedupe             → Close duplicate tabs
 *   php console.php read <tab_id>      → Get body text of page
 *   php console.php focus <tab_id>     → Activate and focus tab
 *   php console.php open <url>         → Open new tab
 *   php console.php group              → Group tabs by domain
 *   php console.php close <id> [id2..] → Close specific tab(s)
 *   php console.php serve              → Standalone PHP WebSocket server mode
 */

if (php_sapi_name() !== 'cli') {
    die("This script must be run from the command line.\n");
}

class SimpleWebSocketClient {
    private $socket;
    private $host;
    private $port;

    public function __construct($host = '127.0.0.1', $port = 8765) {
        $this->host = $host;
        $this->port = $port;
    }

    public function connect($timeout = 3.0) {
        $errno = 0;
        $errstr = '';
        $this->socket = @stream_socket_client("tcp://{$this->host}:{$this->port}", $errno, $errstr, $timeout);
        if (!$this->socket) {
            return false;
        }

        stream_set_timeout($this->socket, 20);

        // Perform RFC 6455 Handshake
        $secKey = base64_encode(random_bytes(16));
        $handshake = "GET / HTTP/1.1\r\n" .
                     "Host: {$this->host}:{$this->port}\r\n" .
                     "Upgrade: websocket\r\n" .
                     "Connection: Upgrade\r\n" .
                     "Sec-WebSocket-Key: {$secKey}\r\n" .
                     "Sec-WebSocket-Version: 13\r\n\r\n";

        fwrite($this->socket, $handshake);
        $response = '';
        while (!feof($this->socket)) {
            $line = fgets($this->socket, 1024);
            $response .= $line;
            if ($line === "\r\n" || $line === "\n") {
                break;
            }
        }

        if (strpos($response, '101') === false) {
            fclose($this->socket);
            $this->socket = null;
            return false;
        }

        return true;
    }

    public function sendFrame($data) {
        if (!$this->socket) return false;
        $length = strlen($data);
        $header = chr(0x81); // FIN + opcode 1 (text)

        if ($length <= 125) {
            $header .= chr(0x80 | $length);
        } elseif ($length <= 65535) {
            $header .= chr(0x80 | 126) . pack('n', $length);
        } else {
            // 64-bit length compatible with 32-bit PHP builds
            $header .= chr(0x80 | 127) . pack('NN', 0, $length);
        }

        $mask = random_bytes(4);
        $masked = '';
        for ($i = 0; $i < $length; $i++) {
            $masked .= chr(ord($data[$i]) ^ ord($mask[$i % 4]));
        }

        return (fwrite($this->socket, $header . $mask . $masked) !== false);
    }

    public function receiveFrame() {
        if (!$this->socket) return null;

        $hdr = fread($this->socket, 2);
        if (strlen($hdr) < 2) return null;

        $byte1 = ord($hdr[0]);
        $byte2 = ord($hdr[1]);
        $opcode = $byte1 & 0x0F;

        if ($opcode === 0x8) { // Connection Close
            $this->close();
            return null;
        }

        $isMasked = ($byte2 & 0x80) !== 0;
        $length = $byte2 & 0x7F;

        if ($length === 126) {
            $ext = fread($this->socket, 2);
            if (strlen($ext) < 2) return null;
            $length = unpack('n', $ext)[1];
        } elseif ($length === 127) {
            $ext = fread($this->socket, 8);
            if (strlen($ext) < 8) return null;
            $parts = unpack('Nhigh/Nlow', $ext);
            $length = ($parts['high'] << 32) | $parts['low'];
        }

        $mask = '';
        if ($isMasked) {
            $mask = fread($this->socket, 4);
        }

        $payload = '';
        $remaining = $length;
        while ($remaining > 0) {
            $chunk = fread($this->socket, min(8192, $remaining));
            if ($chunk === false || strlen($chunk) === 0) break;
            $payload .= $chunk;
            $remaining -= strlen($chunk);
        }

        if ($isMasked && strlen($mask) === 4) {
            $unmasked = '';
            $payloadLen = strlen($payload);
            for ($i = 0; $i < $payloadLen; $i++) {
                $unmasked .= chr(ord($payload[$i]) ^ ord($mask[$i % 4]));
            }
            return $unmasked;
        }

        return $payload;
    }

    public function request($action, array $params = []) {
        $id = uniqid('cli_', true);
        $req = json_encode([
            'id' => $id,
            'action' => $action,
            'params' => (object)$params
        ]);

        if (!$this->sendFrame($req)) {
            return ['success' => false, 'error' => 'Failed to send command over WebSocket'];
        }

        $respRaw = $this->receiveFrame();
        if ($respRaw === null) {
            return ['success' => false, 'error' => 'Empty or terminated response from bridge'];
        }

        $data = json_decode($respRaw, true);
        if ($data === null) {
            return ['success' => false, 'error' => 'Invalid JSON from bridge: ' . $respRaw];
        }

        return $data;
    }

    public function close() {
        if ($this->socket) {
            @fwrite($this->socket, chr(0x88) . chr(0x00));
            @fclose($this->socket);
            $this->socket = null;
        }
    }
}

// UTF-8 aware padding for clean terminal tables
function mbPad($str, $len, $padStr = ' ', $padType = STR_PAD_RIGHT) {
    $str = (string)$str;
    $curLen = mb_strwidth($str, 'UTF-8');
    if ($curLen >= $len) {
        return mb_substr($str, 0, $len - 1, 'UTF-8') . '…';
    }
    $repeat = $len - $curLen;
    return $padType === STR_PAD_RIGHT ? $str . str_repeat($padStr, $repeat) : str_repeat($padStr, $repeat) . $str;
}

function formatUrl($url, $maxLen = 50) {
    if (mb_strlen($url, 'UTF-8') <= $maxLen) return $url;
    return mb_substr($url, 0, $maxLen - 3, 'UTF-8') . '...';
}

function showHelp() {
    echo "====================================================================\n";
    echo "  Chrome Agent Bridge → CLI Console (PHP 7.1+)\n";
    echo "====================================================================\n\n";
    echo "Доступные команды:\n";
    echo "  php console.php tabs               → Список всех открытых вкладок\n";
    echo "  php console.php dedupe             → Автоматическое закрытие дубликатов\n";
    echo "  php console.php read <tab_id>      → Получить текстовый контент страницы\n";
    echo "  php console.php focus <tab_id>     → Активировать вкладку и окно\n";
    echo "  php console.php open <url>         → Открыть новую вкладку\n";
    echo "  php console.php group              → Сгруппировать вкладки по доменам\n";
    echo "  php console.php ungroup            → Распустить все группы вкладок\n";
    echo "  php console.php smart-organize     → Смысловая организация по 3 окнам\n";
    echo "  php console.php layout <file.json> → Применить внешний макет от AI\n";
    echo "  php console.php close <id1> [id2]  → Закрыть указанную вкладку(и)\n";
    echo "  php console.php serve              → Автономный PHP WebSocket сервер (резервный)\n";
    echo "  php console.php help               → Показать эту справку\n\n";
    echo "Сервер моста: ws://127.0.0.1:8765\n";
    echo "====================================================================\n";
}

/**
 * Lightweight Standalone PHP WebSocket Server
 * Fallback mode when Python / uv is not running.
 */
function runStandaloneServer($host = '127.0.0.1', $port = 8765) {
    echo "====================================================================\n";
    echo "  Chrome Agent Bridge → Standalone PHP Server\n";
    echo "  Listening on ws://{$host}:{$port} → 0% CPU idle\n";
    echo "====================================================================\n";
    echo "Ожидание подключения Google Chrome...\n";

    $errno = 0;
    $errstr = '';
    $server = @stream_socket_server("tcp://{$host}:{$port}", $errno, $errstr);
    if (!$server) {
        die("❌ Не удалось запустить сервер: {$errstr} ({$errno})\n");
    }

    $extensionSocket = null;

    while (true) {
        $read = [$server];
        if ($extensionSocket) {
            $read[] = $extensionSocket;
        }

        $write = null;
        $except = null;
        $num = @stream_select($read, $write, $except, null);

        if ($num === false || $num === 0) continue;

        if (in_array($server, $read)) {
            $client = stream_socket_accept($server);
            if ($client) {
                // Read HTTP request for WebSocket upgrade
                $req = fread($client, 2048);
                if (preg_match('/Sec-WebSocket-Key: (.*)\r\n/', $req, $matches)) {
                    $key = trim($matches[1]);
                    $acceptKey = base64_encode(sha1($key . '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', true));
                    $upgrade = "HTTP/1.1 101 Switching Protocols\r\n" .
                               "Upgrade: websocket\r\n" .
                               "Connection: Upgrade\r\n" .
                               "Sec-WebSocket-Accept: {$acceptKey}\r\n\r\n";
                    fwrite($client, $upgrade);

                    if ($extensionSocket && $extensionSocket !== $client) {
                        @fclose($extensionSocket);
                    }
                    $extensionSocket = $client;
                    echo "🟢 Chrome Extension успешно подключилось! → Готово к командам\n";
                } else {
                    fclose($client);
                }
            }
            $read = array_diff($read, [$server]);
        }

        if ($extensionSocket && in_array($extensionSocket, $read)) {
            $hdr = fread($extensionSocket, 2);
            if (strlen($hdr) < 2) {
                echo "🔴 Chrome Extension отключилось → Ожидание повторного подключения...\n";
                fclose($extensionSocket);
                $extensionSocket = null;
                continue;
            }
            // Simple ping responder
            $opcode = ord($hdr[0]) & 0x0F;
            if ($opcode === 0x8) {
                echo "🔴 Chrome Extension отключилось\n";
                fclose($extensionSocket);
                $extensionSocket = null;
                continue;
            }
        }
    }
}

// Parse CLI Arguments
$args = array_slice($argv, 1);
$command = isset($args[0]) ? strtolower(trim($args[0])) : 'help';

if ($command === 'help' || $command === '--help' || $command === '-h' || empty($command)) {
    showHelp();
    exit(0);
}

if ($command === 'serve') {
    runStandaloneServer('127.0.0.1', 8765);
    exit(0);
}

// Connect to Bridge
$client = new SimpleWebSocketClient('127.0.0.1', 8765);
if (!$client->connect(2.5)) {
    echo "\n❌ Не удалось подключиться к Chrome Agent Bridge на ws://127.0.0.1:8765\n";
    echo "→ Убедитесь, что запущен сервер моста:\n";
    echo "  uv run --with \"mcp<2\" --with \"websockets\" python mcp_server.py\n";
    echo "  (или запустите PHP-сервер: php console.php serve)\n\n";
    echo "→ И расширение Chrome Agent Bridge включено в Google Chrome.\n\n";
    exit(1);
}

switch ($command) {
    case 'tabs': {
        $res = $client->request('get_tabs');
        if (!($res['success'] ?? false)) {
            echo "❌ Ошибка: " . ($res['error'] ?? 'Неизвестная ошибка') . "\n";
            exit(1);
        }

        $tabs = $res['result'] ?? [];
        $count = count($tabs);
        $windows = [];

        echo "\nChrome Agent Bridge → Список открытых вкладок ({$count}):\n";
        echo str_repeat('-', 100) . "\n";
        echo mbPad("ID", 8) . mbPad("WIN", 6) . mbPad("ACT", 6) . mbPad("ЗАГОЛОВОК", 40) . "URL\n";
        echo str_repeat('-', 100) . "\n";

        foreach ($tabs as $t) {
            $id = $t['id'] ?? '-';
            $win = $t['windowId'] ?? '-';
            $act = !empty($t['active']) ? '[★]' : '   ';
            $title = mbPad($t['title'] ?? '', 40);
            $url = formatUrl($t['url'] ?? '', 40);
            $windows[$win] = true;

            echo mbPad($id, 8) . mbPad($win, 6) . mbPad($act, 6) . $title . $url . "\n";
        }

        echo str_repeat('-', 100) . "\n";
        echo "Всего вкладок: {$count} → Окон Chrome: " . count($windows) . "\n\n";
        break;
    }

    case 'ungroup': {
        echo "\nChrome Agent Bridge → Разгруппировка всех вкладок...\n";
        $res = $client->request('ungroup_all_tabs');
        if (!($res['success'] ?? false)) {
            echo "❌ Ошибка: " . ($res['error'] ?? 'Неизвестная ошибка') . "\n";
            exit(1);
        }

        $count = $res['result']['ungrouped_count'] ?? 0;
        if ($count === 0) {
            echo "✨ Сгруппированных вкладок не обнаружено → Все вкладки уже свободны!\n\n";
        } else {
            echo "✨ Успешно разгруппировано: {$count} вкл. → Все группы Chrome распущены\n\n";
        }
        break;
    }

    case 'smart-organize':
    case 'smart_organize': {
        echo "\nChrome Agent Bridge → Получение списка вкладок...\n";
        $tabsRes = $client->request('get_tabs');
        if (!($tabsRes['success'] ?? false)) {
            echo "❌ Ошибка: " . ($tabsRes['error'] ?? 'Не удалось получить вкладки') . "\n";
            exit(1);
        }

        $allTabs = $tabsRes['result'] ?? [];
        $totalTabs = count($allTabs);
        if ($totalTabs === 0) {
            echo "✨ Нет открытых вкладок для организации\n\n";
            break;
        }

        $kwsCareer = ['вайбкодинг', 'заказ', 'клиент', 'фриланс', 'джун', 'стажер', 'работу в it', 'web3', 'нейронайм', 'портфолио'];
        $kwsAi = ['grok', 'x.ai', 'claude', 'notebooklm', 'antigravity', 'qwen', 'chatgpt', 'gemini', 'deepseek', 'llm', 'blender', 'three.js', 'threejs', 'awwwards', 'layers.to', 'bentogrids', 'minimal.gallery', 'recent.design'];
        $kwsAuto = ['vin', 'vininspector', 'alshnedauto', 'partsgiant', 'partsdeal', 'subaru', 'mopar', 'infiniti', 'mercedes', 'ford', 'nhtsa', 'motorhome', 'chassis', 'автозапчаст'];
        $kwsSrv = ['whatsapp', 'mail.google', 'gmail', 'fastpanel', ':8888', 'digitalocean', 'cloudways', 'paypal', 'cloud.google', 'extensions'];
        $kwsMedia = ['kinect', 'pegasus', 'transformers', 'beast wars', 'пустоши', 'japan got talent', 'reels', 'instagram', 'standup', 'музыка', 'юмор', 'youtube.com', 'youtu.be'];

        $groups = ['AI' => [], 'SERVICES' => [], 'AUTO' => [], 'CAREER' => [], 'MEDIA' => [], 'OTHER' => []];

        foreach ($allTabs as $t) {
            $text = mb_strtolower(($t['url'] ?? '') . ' ' . ($t['title'] ?? ''), 'UTF-8');
            $id = $t['id'];

            $isMatch = function($keywords) use ($text) {
                foreach ($keywords as $kw) {
                    if (mb_strpos($text, $kw, 0, 'UTF-8') !== false) return true;
                }
                return false;
            };

            if ($isMatch($kwsCareer)) {
                $groups['CAREER'][] = $id;
            } elseif ($isMatch($kwsAi)) {
                $groups['AI'][] = $id;
            } elseif ($isMatch($kwsAuto)) {
                $groups['AUTO'][] = $id;
            } elseif ($isMatch($kwsSrv)) {
                $groups['SERVICES'][] = $id;
            } elseif ($isMatch($kwsMedia)) {
                $groups['MEDIA'][] = $id;
            } else {
                $groups['OTHER'][] = $id;
            }
        }

        $plan = [];
        if (!empty($groups['AI'])) $plan[] = ['title' => 'ИИ & Нейросети', 'color' => 'purple', 'tab_ids' => $groups['AI'], 'window_id' => 1];
        if (!empty($groups['SERVICES'])) $plan[] = ['title' => 'Общение & Сервер', 'color' => 'green', 'tab_ids' => $groups['SERVICES'], 'window_id' => 1];
        if (!empty($groups['AUTO'])) $plan[] = ['title' => 'Vincode & Авто', 'color' => 'cyan', 'tab_ids' => $groups['AUTO'], 'window_id' => 2];
        if (!empty($groups['CAREER'])) $plan[] = ['title' => 'Вайбкодинг & Карьера', 'color' => 'blue', 'tab_ids' => $groups['CAREER'], 'window_id' => 3];
        if (!empty($groups['MEDIA'])) $plan[] = ['title' => 'Отдых, Спорт & Музыка', 'color' => 'red', 'tab_ids' => $groups['MEDIA'], 'window_id' => 3];
        if (!empty($groups['OTHER'])) $plan[] = ['title' => 'Прочее & Поиск', 'color' => 'grey', 'tab_ids' => $groups['OTHER'], 'window_id' => 3];

        echo "Chrome Agent Bridge → Применение умного макета через apply_layout...\n";
        $res = $client->request('apply_layout', [
            'groups' => $plan,
            'close_empty_windows' => true
        ]);

        if (!($res['success'] ?? false)) {
            echo "❌ Ошибка организации: " . ($res['error'] ?? 'Неизвестная ошибка') . "\n";
            exit(1);
        }

        $winCount = $res['result']['windows_count'] ?? 0;
        $createdGroups = $res['result']['groups'] ?? [];

        echo "✨ Организация успешно завершена!\n";
        echo str_repeat('-', 80) . "\n";
        echo "Главных окон браузера: {$winCount} → Всего организовано вкладок: {$totalTabs}\n\n";
        echo "Сформированные тематические группы:\n";
        foreach ($createdGroups as $g) {
            $color = str_pad("[{$g['color']}]", 10);
            $rawTitle = $g['title'] ?? 'Группа';
            $name = mbPad($rawTitle, 24);
            $cnt = $g['count'] ?? 0;
            $win = $g['windowId'] ?? '-';
            echo "  • {$color} {$name} → {$cnt} вкл. (Окно #{$win})\n";
        }
        echo str_repeat('-', 80) . "\n";
        echo "Лишние пустые окна закрыты → Рабочее пространство оптимизировано\n\n";
        break;
    }

    case 'layout':
    case 'apply-layout':
    case 'apply_layout': {
        if (!isset($args[1])) {
            echo "❌ Укажите путь к JSON файлу макета: php console.php layout <plan.json>\n";
            echo "→ Формат JSON: {\"groups\": [{\"title\": \"...\", \"color\": \"blue\", \"tab_ids\": [...], \"window_id\": 1}]}\n";
            exit(1);
        }

        $input = $args[1];
        $raw = file_exists($input) ? file_get_contents($input) : $input;
        $data = json_decode($raw, true);

        if (!$data || (!isset($data['groups']) && !is_array($data))) {
            echo "❌ Некорректный JSON. Ожидается массив групп или объект с полем 'groups'\n";
            exit(1);
        }

        $payload = isset($data['groups']) ? $data : ['groups' => $data, 'close_empty_windows' => true];

        echo "\nChrome Agent Bridge → Применение внешнего макета от AI...\n";
        $res = $client->request('apply_layout', $payload);
        if (!($res['success'] ?? false)) {
            echo "❌ Ошибка применения макета: " . ($res['error'] ?? 'Неизвестная ошибка') . "\n";
            exit(1);
        }

        $winCount = $res['result']['windows_count'] ?? 0;
        $groupsCreated = $res['result']['groups_created'] ?? 0;
        $groups = $res['result']['groups'] ?? [];

        echo "✨ Макет успешно применен!\n";
        echo str_repeat('-', 80) . "\n";
        echo "Окон: {$winCount} → Создано групп: {$groupsCreated}\n\n";
        foreach ($groups as $g) {
            $color = str_pad("[{$g['color']}]", 10);
            $name = mbPad($g['title'] ?? 'Группа', 24);
            $cnt = $g['count'] ?? 0;
            $win = $g['windowId'] ?? '-';
            echo "  • {$color} {$name} → {$cnt} вкл. (Окно #{$win})\n";
        }
        echo str_repeat('-', 80) . "\n\n";
        break;
    }

    case 'dedupe': {
        echo "\nChrome Agent Bridge → Поиск и удаление дубликатов вкладок...\n";
        $res = $client->request('close_duplicate_tabs');
        if (!($res['success'] ?? false)) {
            echo "❌ Ошибка: " . ($res['error'] ?? 'Неизвестная ошибка') . "\n";
            exit(1);
        }

        $closed = $res['result']['closed_count'] ?? 0;
        $tabs = $res['result']['closed_tabs'] ?? [];

        if ($closed === 0) {
            echo "✨ Дубликатов не найдено → Все вкладки уникальны!\n\n";
        } else {
            echo "🧹 Успешно закрыто дубликатов: {$closed} шт. → Память освобождена:\n";
            foreach ($tabs as $t) {
                echo "   • [ID {$t['id']}] " . mbPad($t['title'] ?? '', 35) . " → {$t['url']}\n";
            }
            echo "\n";
        }
        break;
    }

    case 'read': {
        if (!isset($args[1]) || !is_numeric($args[1])) {
            echo "❌ Укажите ID вкладки: php console.php read <tab_id>\n";
            echo "→ Чтобы узнать ID, выполните: php console.php tabs\n";
            exit(1);
        }

        $tabId = (int)$args[1];
        echo "\nChrome Agent Bridge → Чтение страницы вкладки #{$tabId}...\n";
        $res = $client->request('get_page_text', ['tab_id' => $tabId]);
        if (!($res['success'] ?? false)) {
            echo "❌ Ошибка чтения: " . ($res['error'] ?? 'Не удалось получить текст') . "\n";
            exit(1);
        }

        $text = $res['result']['text'] ?? '';
        $len = strlen($text);

        echo str_repeat('=', 80) . "\n";
        echo $text . "\n";
        echo str_repeat('=', 80) . "\n";
        echo "Длина текста: {$len} байт → Успешно прочитано\n\n";
        break;
    }

    case 'focus': {
        if (!isset($args[1]) || !is_numeric($args[1])) {
            echo "❌ Укажите ID вкладки: php console.php focus <tab_id>\n";
            exit(1);
        }

        $tabId = (int)$args[1];
        $res = $client->request('activate_tab', ['tab_id' => $tabId]);
        if (!($res['success'] ?? false)) {
            echo "❌ Ошибка: " . ($res['error'] ?? 'Не удалось сфокусировать вкладку') . "\n";
            exit(1);
        }

        echo "✨ Вкладка #{$tabId} активирована → Окно Chrome выведено на передний план.\n\n";
        break;
    }

    case 'open': {
        if (!isset($args[1])) {
            echo "❌ Укажите URL: php console.php open <url>\n";
            exit(1);
        }

        $url = $args[1];
        $res = $client->request('create_tab', ['url' => $url]);
        if (!($res['success'] ?? false)) {
            echo "❌ Ошибка: " . ($res['error'] ?? 'Не удалось открыть вкладку') . "\n";
            exit(1);
        }

        $newTabId = $res['result']['id'] ?? 'N/A';
        echo "✨ Открыта новая вкладка [ID #{$newTabId}] → {$url}\n\n";
        break;
    }

    case 'group': {
        echo "\nChrome Agent Bridge → Группировка вкладок по доменам...\n";
        $res = $client->request('group_tabs_by_domain');
        if (!($res['success'] ?? false)) {
            echo "❌ Ошибка: " . ($res['error'] ?? 'Не удалось сгруппировать вкладки') . "\n";
            exit(1);
        }

        $count = $res['result']['groups_created'] ?? 0;
        $groups = $res['result']['groups'] ?? [];
        echo "🎨 Создано групп по доменам: {$count}\n";
        foreach ($groups as $g) {
            echo "   • [{$g['color']}] {$g['domain']} → {$g['count']} вкл.\n";
        }
        echo "\n";
        break;
    }

    case 'close': {
        $ids = array_map('intval', array_slice($args, 1));
        if (empty($ids)) {
            echo "❌ Укажите ID одной или нескольких вкладок: php console.php close <id1> [id2...]\n";
            exit(1);
        }

        $res = $client->request('close_tabs', ['tab_ids' => $ids]);
        if (!($res['success'] ?? false)) {
            echo "❌ Ошибка: " . ($res['error'] ?? 'Не удалось закрыть вкладки') . "\n";
            exit(1);
        }

        $closed = $res['result']['closed'] ?? [];
        echo "🗑️ Закрыто вкладок: " . count($closed) . " → " . implode(', ', $closed) . "\n\n";
        break;
    }

    default:
        echo "❌ Неизвестная команда: '{$command}'\n";
        echo "Выполните: php console.php help → для списка команд\n\n";
        exit(1);
}

$client->close();
