<?php
// Formularz wyceny: przyjmuje zapytanie ze strony i wysyła je e-mailem na skrzynkę firmy (mail() na dhostingu).
// Build generuje z tego pliku api/contact.php (src/pages/api/contact.php.ts) i wstawia konfigurację z src/data/site.ts.
declare(strict_types=1);
ini_set('display_errors', '0');

$config = json_decode(<<<'JSON'
__CONFIG__
JSON, true);

const LIMIT_PER_IP_HOUR = 5;
const LIMIT_TOTAL_DAY = 100;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(int $status, string $error = ''): void {
  http_response_code($status);
  echo json_encode($error === '' ? ['ok' => true] : ['ok' => false, 'error' => $error], JSON_UNESCAPED_UNICODE);
  exit;
}

function field(string $key): string {
  $value = $_POST[$key] ?? '';
  return is_string($value) ? trim($value) : '';
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
  header('Allow: POST');
  respond(405, 'Niedozwolona metoda.');
}

// Przeglądarka zawsze dołącza Origin do POST z fetch – przyjmujemy tylko zapytania z naszej strony
if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['origins'], true)) {
  respond(403, 'Niedozwolone źródło zapytania.');
}

// Pułapki na boty: wypełnione ukryte pole albo wysyłka w mniej niż 3 s od wejścia na stronę.
// Udajemy sukces, żeby bot nie próbował dalej.
if (field('website') !== '' || (int) field('elapsed') < 3000) {
  respond(200);
}

$name = field('name');
$phone = field('phone');
$topic = field('topic');
$message = field('message');
$digits = strlen((string) preg_replace('/\D/', '', $phone));

if ($name === '' || mb_strlen($name) > 100) respond(422, 'Podaj imię i nazwisko (do 100 znaków).');
if (!preg_match('/^\+?[0-9 ()-]+$/', $phone) || $digits < 9 || $digits > 15) respond(422, 'Podaj poprawny numer telefonu.');
if (!in_array($topic, $config['topics'], true)) respond(422, 'Wybierz temat zapytania z listy.');
if (mb_strlen($message) > 3000) respond(422, 'Wiadomość może mieć najwyżej 3000 znaków.');
if (field('consent') === '') respond(422, 'Zaznacz zgodę na przetwarzanie danych osobowych.');

// Limit wysyłek. Stan w pliku poza public_html (adresy IP tylko jako skrót, przechowywane 24 h).
$dir = @is_writable(dirname(__DIR__, 2)) ? dirname(__DIR__, 2) : sys_get_temp_dir();
$fp = @fopen($dir . '/.mmsafe-contact-limits.json', 'c+');
if ($fp && flock($fp, LOCK_EX)) {
  $now = time();
  $ip = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? '');
  $log = json_decode((string) stream_get_contents($fp), true);
  $log = array_filter(array_map(
    fn($times) => array_values(array_filter((array) $times, fn($t) => $t > $now - 86400)),
    is_array($log) ? $log : []
  ));
  $mine = count(array_filter($log[$ip] ?? [], fn($t) => $t > $now - 3600));
  $total = array_sum(array_map('count', $log));
  $blocked = $mine >= LIMIT_PER_IP_HOUR || $total >= LIMIT_TOTAL_DAY;
  if (!$blocked) {
    $log[$ip][] = $now;
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($log));
  }
  flock($fp, LOCK_UN);
  fclose($fp);
  if ($blocked) respond(429, 'Wysłano zbyt wiele zapytań. Spróbuj później albo zadzwoń.');
}

$body = implode("\r\n", [
  "Imię i nazwisko: $name",
  "Telefon: $phone",
  "Interesuje mnie: $topic",
  '',
  $message === '' ? '(bez wiadomości)' : $message,
  '',
  'Wyrażam zgodę na przetwarzanie moich danych osobowych w celu przygotowania oferty.',
  '',
  '--',
  "Wiadomość z formularza na stronie {$config['site']}",
]);

// Nadawca z domeny firmy – zgodnie z SPF mmsafe.pl (serwery dhostingu)
$sent = mail(
  $config['recipient'],
  '=?UTF-8?B?' . base64_encode("Zapytanie o wycenę – $topic") . '?=',
  chunk_split(base64_encode($body)),
  [
    'From' => "Formularz MMSafe <{$config['recipient']}>",
    'MIME-Version' => '1.0',
    'Content-Type' => 'text/plain; charset=UTF-8',
    'Content-Transfer-Encoding' => 'base64',
  ],
  '-f' . $config['recipient']
);

$sent ? respond(200) : respond(500, 'Nie udało się wysłać wiadomości.');
