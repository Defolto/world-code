// Деплой на NetAngels одним запуском: npm run deploy
//
// Шаги:
//   1. собирает release/deploy.zip из файлов сайта (без data/ и uploads/ —
//      добавленные через админку свадьбы и фото на сервере не затираются);
//   2. заливает архив на сервер по scp;
//   3. распаковывает по ssh во временную папку, подменяет код и ставит зависимости;
//   4. перезапускает сайт через API NetAngels.
//
// Настройки берутся из .env.deploy в корне проекта (см. .env.deploy.example).
//
// Подсказки:
//   id сайта:            node deploy.mjs --list-sites
//   добавить ssh-ключ:   node deploy.mjs --add-ssh-key [путь к .pub]

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const zipPath = path.join(root, "release", "deploy.zip");

// Что уезжает на сервер. data/ и uploads/ сознательно не трогаем:
// data/weddings.json и data/reviews.json сервер создаст сам, а фото живут только на сервере.
const FILES = [
  "hello.js",
  "server.js",
  "zip.js",
  "package.json",
  "index.html",
  "portfolio.html",
  "reviews.html",
  "admin.html",
  "robots.txt",
  "mainbg-wide.jpg",
  "favicon.ico",
  "favicon.svg",
  "favicon-32.png",
  "favicon-192.png",
  "apple-touch-icon.png",
  "assets",
];

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

// Первый коннект к новому хосту не должен зависать на вопросе про host key
// BatchMode: без ключа ssh сразу падает с ошибкой, а не висит на приглашении пароля
const SSH_OPTS = "-o StrictHostKeyChecking=accept-new -o BatchMode=yes";
// -n отдаёт удалённой команде /dev/null вместо stdin — иначе она может ждать ввод.
// Для scp этой опции нет, поэтому она отдельно от SSH_OPTS.
const SSH_RUN = `ssh -n ${SSH_OPTS}`;

async function deploy() {
  const apiKey = required("NETANGELS_API_KEY");
  const siteId = required("NETANGELS_SITE_ID");
  const sshTarget = required("DEPLOY_SSH"); // например: c12345@h2.netangels.ru
  const deployDir = required("DEPLOY_DIR"); // каталог приложения, например: mysite.ru/app

  console.log("=== 1/4 Собираем архив ===");
  for (const f of FILES) {
    if (!fs.existsSync(path.join(root, f))) {
      throw new Error(`Нет файла ${f} — деплой остановлен`);
    }
  }
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.rmSync(zipPath, { force: true });
  // tar на Windows 10+ умеет zip, если у архива расширение .zip
  run(`tar -a -cf "${zipPath}" ${FILES.join(" ")}`);

  console.log("\n=== 2/4 Заливаем архив по scp ===");
  run(`scp ${SSH_OPTS} "${zipPath}" ${sshTarget}:${deployDir}/deploy.zip`);

  console.log("\n=== 3/4 Распаковываем и ставим зависимости ===");
  // Распаковка во временную папку: если unzip упадёт, старый код останется цел.
  // cp -a подменяет только то, что лежит в архиве — data/ и uploads/ не трогаются.
  const remoteScript = [
    `cd ${deployDir}`,
    "rm -rf .deploy_tmp",
    "mkdir .deploy_tmp",
    "unzip -q deploy.zip -d .deploy_tmp",
    // cp -a, а не mv: assets/ на сервере уже есть, и mv положил бы папку внутрь неё
    "cp -a .deploy_tmp/. .",
    "rm -rf .deploy_tmp",
    "rm deploy.zip",
  ].join(" && ");
  run(`${SSH_RUN} ${sshTarget} "${remoteScript}"`);
  // node/npm на хостинге ставятся через nvm, поэтому подключаем его руками.
  // Раньше здесь был `bash -ic`: интерактивный шелл без TTY ругается на job control
  // ("cannot set terminal process group") и висит, ожидая ввод со stdin.
  const npmScript = [
    'export NVM_DIR="$HOME/.nvm"',
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
    'command -v npm >/dev/null || { echo "npm не найден на сервере"; exit 1; }',
    `cd ${deployDir}`,
    // --no-audit/--no-fund: лишние обращения к реестру, из-за которых шаг тянется минутами
    "npm install --omit=dev --no-audit --no-fund",
  ].join("; ");
  run(`${SSH_RUN} ${sshTarget} "bash -lc '${npmScript}'"`);

  console.log("\n=== 4/4 Перезапускаем сайт через API ===");
  const token = await getToken(apiKey);
  await api(token, "PUT", `/api/v2/hosting/virtualhosts/${siteId}/restart/`);

  console.log("\n✅ Деплой завершён. Проверьте сайт и лог приложения в панели.");
}

if (process.argv.includes("--list-sites")) {
  await listSites();
} else if (process.argv.includes("--add-ssh-key")) {
  await addSshKey();
} else {
  await deploy();
}
