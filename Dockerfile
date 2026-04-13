FROM node:22-alpine

WORKDIR /app

# Копируем конфиги
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

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
