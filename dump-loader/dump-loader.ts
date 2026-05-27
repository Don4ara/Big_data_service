import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync, readFileSync, readSync, closeSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

type Command =
  | 'help'
  | 'prepare'
  | 'start'
  | 'up'
  | 'import'
  | 'stop'
  | 'down'
  | 'reset'
  | 'logs'
  | 'ps'
  | 'clean';

type DumpInfo = {
  path: string;
  fileName: string;
  slug: string;
  composePath: string;
  containerName: string;
  host: string;
  dbName: string;
  user: string;
  password: string;
  port: string;
  image: string;
};

const scriptDir = __dirname;
const dumpsDir = join(scriptDir, 'dumps');
const envPath = join(scriptDir, '.env');
const statePath = join(scriptDir, '.current-dump.json');
const supportedExtensions = ['.sql', '.sql.gz', '.dump', '.backup', '.tar'];

const command = (process.argv[2] ?? 'help') as Command;

async function main(): Promise<void> {
  ensureDumpEnv();

  switch (command) {
    case 'help':
      printHelp();
      return;
    case 'prepare':
      prepare();
      return;
    case 'start':
      await start();
      return;
    case 'up':
      await up();
      return;
    case 'import':
      await importDump();
      return;
    case 'stop':
      await stop();
      return;
    case 'down':
      await down(false);
      return;
    case 'reset':
      await reset();
      return;
    case 'logs':
      await runDockerWithCurrentCompose(['logs', '-f', 'postgres']);
      return;
    case 'ps':
      await runDockerWithCurrentCompose(['ps']);
      return;
    case 'clean':
      cleanGeneratedFiles();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printHelp(): void {
  console.log(`
Команды:
  make dump-import    найти dump, поднять PostgreSQL и загрузить данные
  make dump-start     запустить контейнер
  make dump-up        найти dump и поднять контейнер без импорта
  make dump-stop      остановить контейнер без удаления volume
  make dump-down      остановить контейнер
  make dump-reset     удалить volume и заново загрузить dump
  make dump-logs      показать логи контейнера
  make dump-ps        показать статус контейнера
  make dump-clean     удалить сгенерированные docker-compose.*.yml

Если make не установлен:
  npm run dump:import
  npm run dump:start
  npm run dump:up
  npm run dump:stop
  npm run dump:down
  npm run dump:reset

Куда класть dump:
  dump-loader/dumps

Поддержка:
  .sql, .sql.gz, .dump, .backup, .tar
`);
}

function prepare(): DumpInfo {
  const dump = findDump();
  waitForStableFile(dump.path);

  const info = buildDumpInfo(dump.path);
  const compose = buildCompose(info);

  cleanGeneratedFiles(info.composePath);
  writeFileSync(info.composePath, compose, 'utf8');
  writeFileSync(statePath, JSON.stringify(info, null, 2), 'utf8');

  printSection('Dump loader');
  printRow('Dump', info.fileName);
  printRow('Compose', basename(info.composePath));
  printRow('Container', info.containerName);
  printRow('Image', info.image);
  printRow('Env', basename(envPath));
  printRow('Database URL', getDatabaseUrl(info));
  printConnectionInfo(info);
  console.log('');

  return info;
}

async function up(): Promise<DumpInfo> {
  const info = prepare();
  await startInfo(info, 'Поднимаю PostgreSQL контейнер');
  return info;
}

async function start(): Promise<void> {
  const info = readStateOrPrepare();
  await startInfo(info, 'Запускаю PostgreSQL контейнер');

  printSection('Started');
  printRow('Container', info.containerName);
  printRow('Database URL', getDatabaseUrl(info));
  printConnectionInfo(info);
}

async function importDump(force = false): Promise<void> {
  const info = prepare();
  const containerExistedBeforeStart = dockerContainerExists(info);

  await startInfo(info, 'Поднимаю PostgreSQL контейнер');

  const containerDumpPath = `/dumps/${info.fileName}`;
  const lowerName = info.fileName.toLowerCase();
  const dumpFormat = detectDumpFormat(info.path);

  if (
    !force
    && (isDumpAlreadyImported(info) || (containerExistedBeforeStart && databaseHasUserTables(info)))
  ) {
    printSection('Restore');
    printRow('File', info.fileName);
    printRow('Status', 'already imported, skipped');
    console.log('');

    printSection('Ready');
    printRow('Container', info.containerName);
    printRow('Database URL', getDatabaseUrl(info));
    printConnectionInfo(info);
    writeImportMarker(info);
    return;
  }

  printSection('Restore');
  printRow('File', info.fileName);
  printRow('Format', describeDumpFormat(dumpFormat));
  console.log('');

  if (dumpFormat === 'plain-sql') {
    await runDocker(info, [
      'compose',
      '-f',
      info.composePath,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      info.user,
      '-d',
      info.dbName,
      '-f',
      containerDumpPath,
    ], 'Загружаю SQL dump');
  } else if (dumpFormat === 'plain-sql-gzip') {
    const command = `gzip -dc ${shQuote(containerDumpPath)} | psql -v ON_ERROR_STOP=1 -U ${shQuote(info.user)} -d ${shQuote(info.dbName)}`;
    await runDocker(info, ['compose', '-f', info.composePath, 'exec', '-T', 'postgres', 'sh', '-lc', command], 'Распаковываю и загружаю SQL dump');
  } else {
    await runDocker(info, [
      'compose',
      '-f',
      info.composePath,
      'exec',
      '-T',
      'postgres',
      'pg_restore',
      '--clean',
      '--if-exists',
      '--no-owner',
      `--role=${info.user}`,
      '-U',
      info.user,
      '-d',
      info.dbName,
      containerDumpPath,
    ], 'Восстанавливаю dump через pg_restore');
  }

  printSection('Done');
  printRow('Status', 'import finished');
  printRow('Database URL', getDatabaseUrl(info));
  printConnectionInfo(info);
  writeImportMarker(info);
}

async function startInfo(info: DumpInfo, title: string): Promise<void> {
  await runDocker(info, ['compose', '-f', info.composePath, 'up', '-d', 'postgres'], title);
  waitForPostgres(info);
}

async function down(removeVolumes: boolean): Promise<void> {
  const info = readStateOrPrepare();
  const args = ['compose', '-f', info.composePath, 'down'];

  if (removeVolumes) {
    args.push('-v');
  }

  await runDocker(info, args, removeVolumes ? 'Останавливаю контейнер и удаляю volume' : 'Останавливаю контейнер');
}

async function stop(): Promise<void> {
  const info = readStateOrPrepare();
  await runDocker(
    info,
    ['compose', '-f', info.composePath, 'stop', 'postgres'],
    'Останавливаю PostgreSQL контейнер',
  );

  printSection('Stopped');
  printRow('Container', info.containerName);
}

async function reset(): Promise<void> {
  const info = readStateOrPrepare();
  deleteImportMarker(info);

  try {
    await down(true);
  } catch (error) {
    console.warn(`Down skipped: ${(error as Error).message}`);
  }

  await importDump(true);
}

function findDump(): { path: string } {
  if (!existsSync(dumpsDir)) {
    throw new Error(`Папка для dump не найдена: ${dumpsDir}`);
  }

  const files = readdirSync(dumpsDir)
    .map((fileName) => join(dumpsDir, fileName))
    .filter((path) => statSync(path).isFile())
    .filter(isSupportedDump)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  if (files.length === 0) {
    throw new Error(
      [
        'Dump-файл не найден.',
        `Положи файл в папку: ${dumpsDir}`,
        'Поддерживаются: .sql, .sql.gz, .dump, .backup, .tar',
      ].join('\n'),
    );
  }

  return { path: files[0] };
}

function buildDumpInfo(dumpPath: string): DumpInfo {
  const fileName = basename(dumpPath);
  const slug = slugify(stripDumpExtension(fileName));
  const host = getEnvValue('POSTGRES_HOST');
  const user = getEnvValue('POSTGRES_USER');
  const password = getEnvValue('POSTGRES_PASSWORD');
  const dbName = getEnvValue('POSTGRES_DB');
  const port = getEnvValue('POSTGRES_PORT');
  const image = getEnvValue('POSTGRES_IMAGE');

  return {
    path: resolve(dumpPath),
    fileName,
    slug,
    composePath: join(scriptDir, `docker-compose.${slug}.yml`),
    containerName: `data_vitrine_dump_${slug}`,
    host,
    dbName,
    user,
    password,
    port,
    image,
  };
}

function buildCompose(info: DumpInfo): string {
  return `name: dump-loader-${info.slug}

services:
  postgres:
    env_file:
      - .env
    image: \${POSTGRES_IMAGE:-${info.image}}
    container_name: ${info.containerName}
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-${info.user}}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-${info.password}}
      POSTGRES_DB: \${POSTGRES_DB:-${info.dbName}}
    ports:
      - "\${POSTGRES_PORT:-${info.port}}:5432"
    volumes:
      - dump_${info.slug}_pgdata:/var/lib/postgresql/data
      - ./dumps:/dumps:ro

volumes:
  dump_${info.slug}_pgdata:
`;
}

function readStateOrPrepare(): DumpInfo {
  if (existsSync(statePath)) {
    const info = normalizeDumpInfo(JSON.parse(readFileSync(statePath, 'utf8')) as Partial<DumpInfo>);

    if (existsSync(info.composePath)) {
      return info;
    }
  }

  return prepare();
}

function normalizeDumpInfo(info: Partial<DumpInfo>): DumpInfo {
  const defaults = getDefaultEnvValues();

  return {
    path: info.path || '',
    fileName: info.fileName || '',
    slug: info.slug || 'dump',
    composePath: info.composePath || join(scriptDir, 'docker-compose.dump.yml'),
    containerName: info.containerName || 'data_vitrine_dump',
    host: info.host || process.env.POSTGRES_HOST || defaults.POSTGRES_HOST,
    dbName: info.dbName || process.env.POSTGRES_DB || defaults.POSTGRES_DB,
    user: info.user || process.env.POSTGRES_USER || defaults.POSTGRES_USER,
    password: info.password || process.env.POSTGRES_PASSWORD || defaults.POSTGRES_PASSWORD,
    port: info.port || process.env.POSTGRES_PORT || defaults.POSTGRES_PORT,
    image: info.image || process.env.POSTGRES_IMAGE || defaults.POSTGRES_IMAGE,
  };
}

async function runDockerWithCurrentCompose(args: string[]): Promise<void> {
  const info = readStateOrPrepare();
  await runDocker(info, ['compose', '-f', info.composePath, ...args], `docker ${args.join(' ')}`, true);
}

function runDocker(info: DumpInfo, args: string[], title = 'Docker command', forceStream = false): Promise<void> {
  const shouldStream = forceStream || process.env.DUMP_VERBOSE === 'true';

  console.log(`[RUN] ${title}`);

  if (process.env.DUMP_VERBOSE === 'true') {
    console.log(`      docker ${args.join(' ')}`);
  }

  return new Promise((resolveRun, rejectRun) => {
    const child = spawn('docker', args, {
      cwd: dirname(info.composePath),
      windowsHide: true,
    });

    let output = '';
    let progressTimer: NodeJS.Timeout | undefined;

    if (!shouldStream) {
      process.stdout.write('      ');
      progressTimer = setInterval(() => process.stdout.write('.'), 2000);
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;

      if (shouldStream) {
        process.stdout.write(text);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;

      if (shouldStream) {
        process.stderr.write(text);
      }
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (progressTimer) {
        clearInterval(progressTimer);
        process.stdout.write('\n');
      }

      if (error.code === 'ENOENT') {
        rejectRun(new Error('Docker не найден. Проверь, что Docker Desktop установлен и команда docker доступна в терминале.'));
        return;
      }

      rejectRun(error);
    });

    child.on('close', (code) => {
      if (progressTimer) {
        clearInterval(progressTimer);
        process.stdout.write('\n');
      }

      if (code === 0) {
        console.log(`[OK]  ${title}`);
        resolveRun();
        return;
      }

      if (!shouldStream && output.trim()) {
        console.error(output.trim());
      }

      if (isDockerEngineMessage(output) || isDockerEngineNotRunning()) {
        rejectRun(
          new Error(
            [
              'Docker установлен, но Docker Engine недоступен.',
              'Открой Docker Desktop и дождись статуса Running.',
              'Если Docker уже запущен, открой терминал от имени администратора.',
              'Команда: npm run dump:import',
            ].join('\n'),
          ),
        );
        return;
      }

      if (output.includes('unsupported version') && output.includes('file header')) {
        rejectRun(
          new Error(
            [
              'Dump создан более новой версией PostgreSQL, чем pg_restore внутри контейнера.',
              `Сейчас используется образ: ${info.image}`,
              'Попробуй PostgreSQL 17 или новее:',
              '$env:POSTGRES_IMAGE = "postgres:17-alpine"',
              'npm run dump:reset',
            ].join('\n'),
          ),
        );
        return;
      }

      rejectRun(new Error('Docker-команда завершилась с ошибкой. Подробности выше в выводе Docker.'));
    });
  });
}

function dockerContainerExists(info: DumpInfo): boolean {
  const result = spawnSync('docker', ['container', 'inspect', info.containerName], {
    cwd: dirname(info.composePath),
    stdio: 'ignore',
  });

  return result.status === 0;
}

function databaseHasUserTables(info: DumpInfo): boolean {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      info.composePath,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      info.user,
      '-d',
      info.dbName,
      '-tAc',
      "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';",
    ],
    {
      cwd: dirname(info.composePath),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );

  if (result.status !== 0) {
    return false;
  }

  return Number.parseInt(result.stdout.trim(), 10) > 0;
}

function isDockerEngineNotRunning(): boolean {
  try {
    execFileSync('docker', ['info'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return false;
  } catch (error) {
    const message = isNodeError(error)
      ? `${error.message}\n${String(getExecOutput(error, 'stderr'))}\n${String(getExecOutput(error, 'stdout'))}`
      : String(error);

    return isDockerEngineMessage(message);
  }
}

function isDockerEngineMessage(message: string): boolean {
  return message.includes('dockerDesktopLinuxEngine')
    || message.includes('docker_engine')
    || message.includes('Cannot connect to the Docker daemon')
    || message.includes('error during connect')
    || message.includes('must be run with elevated privileges');
}

function getExecOutput(error: Error, key: 'stdout' | 'stderr'): unknown {
  return (error as Error & Partial<Record<'stdout' | 'stderr', unknown>>)[key];
}

function waitForPostgres(info: DumpInfo): void {
  console.log('[RUN] Жду готовность PostgreSQL');
  process.stdout.write('      ');

  for (let attempt = 1; attempt <= 60; attempt++) {
    const result = spawnSync(
      'docker',
      [
        'compose',
        '-f',
        info.composePath,
        'exec',
        '-T',
        'postgres',
        'pg_isready',
        '-U',
        info.user,
        '-d',
        info.dbName,
      ],
      {
        cwd: dirname(info.composePath),
        stdio: 'ignore',
      },
    );

    if (result.status === 0) {
      process.stdout.write('\n');
      console.log('[OK]  PostgreSQL готов');
      return;
    }

    if (attempt % 2 === 0) {
      process.stdout.write('.');
    }

    sleep(1000);
  }

  process.stdout.write('\n');
  throw new Error('PostgreSQL did not become ready in time.');
}

function waitForStableFile(path: string): void {
  let lastSize = -1;

  for (let attempt = 1; attempt <= 120; attempt++) {
    const currentSize = statSync(path).size;

    if (currentSize > 0 && currentSize === lastSize) {
      return;
    }

    lastSize = currentSize;
    sleep(1000);
  }

  throw new Error(`Dump file is empty or still changing: ${path}`);
}

function getImportMarkerPath(info: DumpInfo): string {
  return join(scriptDir, `.imported.${info.slug}.json`);
}

function getDumpFingerprint(info: DumpInfo): { fileName: string; size: number; mtimeMs: number } {
  const stats = statSync(info.path);

  return {
    fileName: info.fileName,
    size: stats.size,
    mtimeMs: Math.trunc(stats.mtimeMs),
  };
}

function isDumpAlreadyImported(info: DumpInfo): boolean {
  const markerPath = getImportMarkerPath(info);

  if (!existsSync(markerPath)) {
    return false;
  }

  try {
    const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as {
      fileName?: string;
      size?: number;
      mtimeMs?: number;
      dbName?: string;
      port?: string;
      image?: string;
    };
    const current = getDumpFingerprint(info);

    return marker.fileName === current.fileName
      && marker.size === current.size
      && marker.mtimeMs === current.mtimeMs
      && marker.dbName === info.dbName
      && marker.port === info.port
      && marker.image === info.image;
  } catch {
    return false;
  }
}

function writeImportMarker(info: DumpInfo): void {
  writeFileSync(
    getImportMarkerPath(info),
    JSON.stringify(
      {
        ...getDumpFingerprint(info),
        dbName: info.dbName,
        port: info.port,
        image: info.image,
        importedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

function deleteImportMarker(info: DumpInfo): void {
  const markerPath = getImportMarkerPath(info);

  if (existsSync(markerPath)) {
    unlinkSync(markerPath);
  }
}

function ensureDumpEnv(): void {
  if (!existsSync(envPath)) {
    writeFileSync(envPath, buildDefaultEnv(), 'utf8');
  }

  const content = readFileSync(envPath, 'utf8');
  const values = parseEnvFile(content);
  const missingLines: string[] = [];

  for (const [key, value] of Object.entries(getDefaultEnvValues())) {
    if (!values[key]) {
      values[key] = value;
      missingLines.push(`${key}=${value}`);
    }
  }

  if (missingLines.length > 0) {
    const separator = content.endsWith('\n') || content.length === 0 ? '' : '\n';
    writeFileSync(envPath, `${content}${separator}${missingLines.join('\n')}\n`, 'utf8');
  }

  for (const [key, value] of Object.entries(values)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function getEnvValue(key: keyof ReturnType<typeof getDefaultEnvValues>): string {
  return process.env[key] || getDefaultEnvValues()[key];
}

function getDefaultEnvValues(): Record<string, string> {
  return {
    POSTGRES_HOST: 'localhost',
    POSTGRES_PORT: '55432',
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: 'postgres',
    POSTGRES_DB: 'big_data_service',
    POSTGRES_IMAGE: 'postgres:17-alpine',
  };
}

function buildDefaultEnv(): string {
  return buildEnvContent(getDefaultEnvValues());
}

function buildEnvContent(values: Record<string, string>): string {
  const defaults = getDefaultEnvValues();

  return `${Object.keys(defaults)
    .map((key) => `${key}=${values[key] || defaults[key]}`)
    .join('\n')}
`;
}

function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    values[key] = unquoteEnvValue(rawValue);
  }

  return values;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function cleanGeneratedFiles(keepPath?: string): void {
  const keep = keepPath ? resolve(keepPath) : null;

  for (const fileName of readdirSync(scriptDir)) {
    if (!/^docker-compose\..+\.yml$/i.test(fileName)) {
      continue;
    }

    const filePath = resolve(join(scriptDir, fileName));

    if (keep && filePath === keep) {
      continue;
    }

    unlinkSync(filePath);
  }

  if (!keep && existsSync(statePath)) {
    unlinkSync(statePath);
  }
}

function isSupportedDump(path: string): boolean {
  const fileName = basename(path).toLowerCase();
  return supportedExtensions.some((extension) => fileName.endsWith(extension));
}

function detectDumpFormat(path: string): 'plain-sql' | 'plain-sql-gzip' | 'pg-restore' {
  const fileName = basename(path).toLowerCase();
  const header = readHeader(path, 8);

  if (header.subarray(0, 5).toString('ascii') === 'PGDMP') {
    return 'pg-restore';
  }

  if (fileName.endsWith('.dump') || fileName.endsWith('.backup') || fileName.endsWith('.tar')) {
    return 'pg-restore';
  }

  if (fileName.endsWith('.sql.gz')) {
    return 'plain-sql-gzip';
  }

  return 'plain-sql';
}

function describeDumpFormat(format: 'plain-sql' | 'plain-sql-gzip' | 'pg-restore'): string {
  switch (format) {
    case 'plain-sql':
      return 'plain SQL через psql';
    case 'plain-sql-gzip':
      return 'gzip SQL через gzip + psql';
    case 'pg-restore':
      return 'PostgreSQL dump через pg_restore';
  }
}

function readHeader(path: string, size: number): Buffer {
  const buffer = Buffer.alloc(size);
  const fd = openSync(path, 'r');

  try {
    const bytesRead = readSync(fd, buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function stripDumpExtension(fileName: string): string {
  const lowerName = fileName.toLowerCase();

  for (const extension of supportedExtensions.sort((left, right) => right.length - left.length)) {
    if (lowerName.endsWith(extension)) {
      return fileName.slice(0, -extension.length);
    }
  }

  return fileName;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  return slug || 'dump';
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function printSection(title: string): void {
  console.log('');
  console.log(`== ${title} ==`);
}

function printRow(label: string, value: string): void {
  console.log(`  ${label.padEnd(12)}: ${value}`);
}

function getDatabaseUrl(info: DumpInfo): string {
  return `postgresql://${info.user}:${info.password}@${info.host}:${info.port}/${info.dbName}?schema=public`;
}

function getJdbcUrl(info: DumpInfo): string {
  return `jdbc:postgresql://${info.host}:${info.port}/${info.dbName}`;
}

function printConnectionInfo(info: DumpInfo): void {
  console.log('');
  console.log('  DBeaver:');
  printRow('Driver', 'PostgreSQL');
  printRow('Host', info.host);
  printRow('Port', info.port);
  printRow('Database', info.dbName);
  printRow('Username', info.user);
  printRow('Password', info.password);
  printRow('JDBC URL', getJdbcUrl(info));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return String(error);
}

main().catch((error) => {
  console.error('');
  console.error('Ошибка:');
  console.error(getErrorMessage(error));

  if (process.env.DUMP_DEBUG === 'true' && error instanceof Error && error.stack) {
    console.error('');
    console.error(error.stack);
  }

  process.exitCode = 1;
});
