// Деплой «мирКода» на NetAngels одним запуском: npm run deploy
//
// Шаги:
//   1. собирает фронтенд (vite build) — пропускается флагом --skip-build;
//   2. пакует release/deploy.zip: app/ (бэкенд) и www/ (сборка фронтенда);
//   3. заливает архив по scp;
//   4. по ssh заменяет app/ и www/ целиком и ставит зависимости в venv сайта;
//   5. перезапускает сайт через API NetAngels.
//
// Настройки берутся из .env.deploy в корне проекта (см. .env.deploy.example).
//
// Подсказки:
//   id сайта:            npm run deploy -- --list-sites
//   добавить ssh-ключ:   npm run deploy -- --add-ssh-key [путь к .pub]
//   без пересборки:      npm run deploy -- --skip-build

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const zipPath = path.join(root, "release", "deploy.zip");

/* ──────────────────────────── Раскладка ────────────────────────────
 *
 * Локально:
 *   backend/            ASGI-приложение и requirements.txt
 *   frontend/           React + Vite, сборка уезжает в frontend/dist
 *
 * На сервере ($DEPLOY_DIR) раскладку задаёт пресет Python ASGI, не мы:
 *   app/                код приложения; панель запускает отсюда asgi:app
 *   www/                статика
 *   .env/               venv, создан панелью (именно .env, не .venv)
 *   .envrc              активирует .env и подхватывает etc/environment
 *   etc/environment/    переменные окружения: файл на переменную
 *   log/, tmp/, reload  служебное хозяйство пресета
 *
 * Деплой заменяет app/ и www/ и не трогает больше ничего. Заменяет
 * целиком, а не копирует поверх: при копировании удалённый .py остаётся
 * на сервере и продолжает импортироваться, а старые чанки Vite копятся
 * бесконечно. Всё, что должно пережить деплой, лежит вне этих двух
 * каталогов — раскладка пресета удачно совпадает с этим правилом.
 */

const BUNDLE = [
  { from: "backend", to: "app" },
  { from: "frontend/dist", to: "www" },
];

// Каталоги на сервере, которые деплой заменяет целиком
const REPLACED = BUNDLE.map((entry) => entry.to);

// venv сайта. Создан панелью вместе с сайтом, пересоздавать его не нужно
// и не следует: панель запускает приложение именно из него.
const VENV = ".env";

// В архив не кладём мусор разработки. Локальный backend/.venv весит
// десятки мегабайт и на сервере не нужен — там свой.
const SKIP = /(^|[\\/])(__pycache__|\.venv|\.pytest_cache|\.ruff_cache|node_modules)([\\/]|$)/;

/* ─────────────────────── Конфиг из .env.deploy ─────────────────────── */

function loadDeployEnv() {
  const envPath = path.join(root, ".env.deploy");
  if (!fs.existsSync(envPath)) {
    console.error("Нет файла .env.deploy — скопируйте .env.deploy.example и заполните значения.");
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const value = trimmed.slice(eq + 1).trim();
    env[trimmed.slice(0, eq).trim()] = value.replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}

const env = loadDeployEnv();

function required(name) {
  if (!env[name]) {
    console.error(`В .env.deploy не задан ${name}`);
    process.exit(1);
  }
  return env[name];
}

function run(cmd, options = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit", ...options });
}

/* ─────────────────────────── API NetAngels ─────────────────────────── */

// Токен по API-ключу; живёт 24 часа, но нам хватает одного запуска
async function getToken(apiKey) {
  const res = await fetch("https://panel.netangels.ru/api/gateway/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `api_key=${encodeURIComponent(apiKey)}`,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    throw new Error(`Не удалось получить токен NetAngels: ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function api(token, method, apiPath, body) {
  const res = await fetch(`https://api-ms.netangels.ru${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body && { "Content-Type": "application/json" }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${apiPath} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

// Печатает контейнеры и сайты с id — чтобы заполнить NETANGELS_SITE_ID
async function listSites() {
  const token = await getToken(required("NETANGELS_API_KEY"));
  const containers = await api(token, "GET", "/api/v2/hosting/containers/");
  for (const container of containers.entities ?? []) {
    console.log(`\nКонтейнер #${container.id} (${container.name ?? ""})`);
    const sites = await api(token, "GET", `/api/v2/hosting/containers/${container.id}/virtualhosts/`);
    for (const site of sites.entities ?? []) {
      console.log(`  сайт #${site.id}: ${site.name}`);
    }
  }
}

// Добавляет локальный публичный SSH-ключ в контейнер хостинга,
// чтобы scp/ssh работали без пароля
async function addSshKey() {
  const argIndex = process.argv.indexOf("--add-ssh-key");
  const keyPath = process.argv[argIndex + 1] ?? path.join(os.homedir(), ".ssh", "id_rsa.pub");
  const key = fs.readFileSync(keyPath, "utf8").trim();

  const token = await getToken(required("NETANGELS_API_KEY"));
  const containers = (await api(token, "GET", "/api/v2/hosting/containers/")).entities ?? [];
  if (containers.length === 0) {
    throw new Error("В аккаунте нет контейнеров");
  }
  const container = containers[0];
  await api(token, "POST", `/api/v2/hosting/containers/${container.id}/ssh/create/`, {
    key,
    name: `deploy ${os.hostname()}`,
  });
  console.log(`✅ Ключ ${keyPath} добавлен в контейнер #${container.id} (${container.name ?? ""})`);
}

/* ─────────────────────────────── Деплой ─────────────────────────────── */

// Первый коннект к новому хосту не должен зависать на вопросе про host key.
// BatchMode: без ключа ssh сразу падает с ошибкой, а не висит на пароле.
const SSH_OPTS = "-o StrictHostKeyChecking=accept-new -o BatchMode=yes";
// -n отдаёт удалённой команде /dev/null вместо stdin — иначе она может
// ждать ввод. Для scp этой опции нет, поэтому она отдельно от SSH_OPTS.
const SSH_RUN = `ssh -n ${SSH_OPTS}`;

// Удалённые команды заворачиваем в bash -lc: python и node на хостинге
// подключаются через профиль, в неинтерактивном шелле их нет в PATH.
// Именно -lc, а не -ic: интерактивный шелл без TTY ругается на job control
// ("cannot set terminal process group") и виснет, ожидая ввод со stdin.
function remote(sshTarget, script) {
  const oneLine = script.filter(Boolean).join("; ");
  run(`${SSH_RUN} ${sshTarget} "bash -lc '${oneLine}'"`);
}

function buildFrontend() {
  if (process.argv.includes("--skip-build")) {
    console.log("Пропускаем сборку фронтенда (--skip-build)");
    return;
  }
  if (!fs.existsSync(path.join(root, "frontend", "package.json"))) {
    throw new Error("Нет frontend/package.json — деплой остановлен");
  }
  run("npm run build", { cwd: path.join(root, "frontend") });
}

function makeArchive() {
  for (const entry of BUNDLE) {
    if (!fs.existsSync(path.join(root, entry.from))) {
      throw new Error(`Нет каталога ${entry.from} — деплой остановлен`);
    }
  }

  // Собираем staging-каталог, чтобы имена внутри архива были серверными
  // (backend → app, frontend/dist → www). Иначе пришлось бы переименовывать
  // на сервере, а это лишний шаг, на котором легко потерять содержимое.
  const staging = path.join(root, "release", "staging");
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const entry of BUNDLE) {
    fs.cpSync(path.join(root, entry.from), path.join(staging, entry.to), {
      recursive: true,
      filter: (src) => !SKIP.test(src),
    });
  }

  fs.rmSync(zipPath, { force: true });
  // tar на Windows 10+ умеет zip, если у архива расширение .zip
  run(`tar -a -cf "${zipPath}" ${REPLACED.map((d) => `"${d}"`).join(" ")}`, { cwd: staging });
  fs.rmSync(staging, { recursive: true, force: true });

  const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  console.log(`Архив собран: ${mb} МБ`);
}

async function deploy() {
  const apiKey = required("NETANGELS_API_KEY");
  const siteId = required("NETANGELS_SITE_ID");
  const sshTarget = required("DEPLOY_SSH"); // например: c35697@h65.netangels.ru
  const deployDir = required("DEPLOY_DIR"); // корень сайта, punycode-имя

  console.log("=== 1/5 Собираем фронтенд ===");
  buildFrontend();

  console.log("\n=== 2/5 Пакуем архив ===");
  makeArchive();

  console.log("\n=== 3/5 Заливаем архив по scp ===");
  // Сайт создаёт панель вместе с venv и конфигом, поэтому каталог обязан
  // существовать. Если его нет — почти наверняка ошибка в DEPLOY_DIR,
  // и лучше остановиться, чем создать пустышку рядом с настоящим сайтом.
  remote(sshTarget, [
    `[ -d ${deployDir} ] || { echo "Нет каталога ${deployDir} на сервере"; exit 1; }`,
    `[ -x ${deployDir}/${VENV}/bin/python ] || { echo "Нет venv ${deployDir}/${VENV} — сайт создан не пресетом Python ASGI?"; exit 1; }`,
  ]);
  run(`scp ${SSH_OPTS} "${zipPath}" ${sshTarget}:${deployDir}/deploy.zip`);

  console.log("\n=== 4/5 Разворачиваем и ставим зависимости ===");
  // Распаковка во временную папку: если unzip упадёт, старый код цел.
  // Каталоги подменяются переименованием — окно, в котором сайт видит
  // полурасползшийся код, сокращается до одного mv на каталог.
  remote(sshTarget, [
    `cd ${deployDir}`,
    "rm -rf .deploy_tmp .deploy_old",
    "mkdir -p .deploy_tmp .deploy_old",
    "unzip -q deploy.zip -d .deploy_tmp",
    ...REPLACED.map(
      (dir) => `if [ -d ${dir} ]; then mv ${dir} .deploy_old/${dir}; fi && mv .deploy_tmp/${dir} ${dir}`,
    ),
    "rm -rf .deploy_tmp .deploy_old deploy.zip",
  ]);

  // Ставим в venv сайта, а не в свой: панель запускает приложение именно
  // из него. --quiet, потому что иначе вывод pip тонет в тысяче строк.
  remote(sshTarget, [
    `cd ${deployDir}`,
    `${VENV}/bin/python -V`,
    `${VENV}/bin/python -m pip install --quiet --upgrade pip`,
    `${VENV}/bin/python -m pip install --quiet -r app/requirements.txt`,
  ]);

  console.log("\n=== 5/5 Перезапускаем сайт через API ===");
  const token = await getToken(apiKey);
  await api(token, "PUT", `/api/v2/hosting/virtualhosts/${siteId}/restart/`);

  console.log("\n✅ Деплой завершён. Проверьте /health на сайте.");
}

if (process.argv.includes("--list-sites")) {
  await listSites();
} else if (process.argv.includes("--add-ssh-key")) {
  await addSshKey();
} else {
  await deploy();
}
