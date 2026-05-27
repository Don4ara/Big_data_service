# Загрузка dump через Makefile

Папка `dump-loader` разворачивает отдельный PostgreSQL-контейнер из dump-файла.

## Быстрый запуск

1. Положи dump в папку:

```text
dump-loader\dumps
```

2. Запусти из корня проекта:

```powershell
npm run dump:import
```

Если установлен `make`, можно так:

```powershell
make dump-import
```

## Настройки

При первом запуске автоматически создаётся файл:

```text
dump-loader\.env
```

В нём лежат параметры базы:

```env
POSTGRES_HOST=localhost
POSTGRES_PORT=55432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=big_data_service
POSTGRES_IMAGE=postgres:17-alpine
```

Если `.env` уже существует, утилита берёт настройки из него.

## Подключение в DBeaver

Параметры выводятся после запуска команды. По умолчанию:

```text
Driver: PostgreSQL
Host: localhost
Port: 55432
Database: big_data_service
Username: postgres
Password: postgres
JDBC URL: jdbc:postgresql://localhost:55432/big_data_service
```

## Команды

```powershell
npm run dump:import
```

Поднять контейнер и загрузить dump.
Если этот же dump уже был успешно загружен, повторный запуск просто поднимет контейнер и пропустит импорт.

```powershell
npm run dump:start
```

Запустить контейнер после остановки. Если контейнера ещё нет, команда поднимет его без повторного импорта.

```powershell
npm run dump:up
```

Подготовить compose и поднять контейнер без импорта.

```powershell
npm run dump:stop
```

Остановить контейнер, но оставить volume и сеть.

```powershell
npm run dump:down
```

Остановить контейнер и убрать compose-сеть. Данные в volume остаются.

```powershell
npm run dump:reset
```

Удалить volume и заново загрузить dump.
Используй эту команду, если нужно принудительно перезалить тот же dump.

```powershell
npm run dump:logs
```

Показать логи PostgreSQL.

## Поддерживаемые dump-файлы

- `.sql`
- `.sql.gz`
- `.dump`
- `.backup`
- `.tar`

Если в папке несколько dump-файлов, выбирается самый новый по дате изменения.

## Полный Docker-вывод

Обычно вывод короткий. Для подробного Docker-лога:

```powershell
$env:DUMP_VERBOSE = "true"
npm run dump:import
```

## Если версия dump новее

Если появилась ошибка `unsupported version (...) in file header`, укажи более новый PostgreSQL-образ в `dump-loader\.env`, например:

```env
POSTGRES_IMAGE=postgres:17-alpine
```

После изменения образа лучше пересоздать volume:

```powershell
npm run dump:reset
```
