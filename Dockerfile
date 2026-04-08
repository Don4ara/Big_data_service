FROM node:22-alpine

WORKDIR /app

# Копируем конфиги
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Настройки npm для стабильной установки в Docker
RUN npm config set maxsockets 3 && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000

# Устанавливаем зависимости
RUN npm install

# Генерация Prisma-клиента
RUN npx prisma generate

# Копируем исходный код
COPY src ./src

# Сборка
RUN npm run build

# Запуск приложения (NestJS компилирует в dist/src/)
CMD ["node", "dist/src/main.js"]
