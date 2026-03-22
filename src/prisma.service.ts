import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PrismaService.name);
    private readonly pool: Pool;

    constructor() {
        const connectionString = process.env.DATABASE_URL;
        const pool = new Pool({ connectionString });
        
        // Обработка разрывов сети для idle-сессий: мертвые сессии удалятся из пула
        pool.on('error', (err) => {
            console.error('Упс, обрыв соединения с БД в фоне (idle). Пул восстановится автоматически.', err.message);
        });

        const adapter = new PrismaPg(pool);
        super({ adapter } as any);
        this.pool = pool;
    }

    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
        await this.pool.end();
    }
}
