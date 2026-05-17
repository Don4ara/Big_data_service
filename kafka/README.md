# Kafka

Эта инструкция нужна, чтобы поднять Kafka и отправлять туда сгенерированные заказы.

## Быстрый запуск

Из корня проекта:

```powershell
docker compose up -d kafka kafka-ui
```

Kafka UI:

```text
http://localhost:8080
```

Если в `.env` указан другой порт:

```env
KAFKA_UI_PORT=8081
```

то Kafka UI будет здесь:

```text
http://localhost:8081
```

## Настройки `.env`

Для отправки заказов в Kafka включи:

```env
KAFKA_ENABLED=true
KAFKA_BROKERS=localhost:9092
KAFKA_TOPIC=data-vitrine.orders.generated
KAFKA_CLIENT_ID=data-vitrine-api
KAFKA_PORT=9092
KAFKA_UI_PORT=8080
```

## Отправить заказы в Kafka

Сначала запусти backend:

```powershell
npm run start:dev
```

Потом вызови endpoint:

```powershell
curl "http://localhost:3000/data-vitrine/generate/kafka?count=5000"
```

Этот режим отправляет заказы в Kafka и не пишет их в PostgreSQL.

## Остановить Kafka

```powershell
docker compose stop kafka kafka-ui
```

## Полностью убрать Kafka-контейнеры

```powershell
docker compose rm -f kafka kafka-ui
```
