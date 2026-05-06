import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

type KafkaProducerLike = {
  connect: () => Promise<void>;
  send: (args: {
    topic: string;
    messages: Array<{
      key?: string;
      value: string;
      headers?: Record<string, string>;
    }>;
  }) => Promise<void>;
  disconnect: () => Promise<void>;
};

type KafkaJsModule = {
  Kafka: new (config: {
    clientId: string;
    brokers: string[];
    connectionTimeout?: number;
    requestTimeout?: number;
    retry?: {
      initialRetryTime?: number;
      retries?: number;
    };
  }) => { producer: (config?: KafkaProducerConfig) => KafkaProducerLike };
  Partitioners: {
    LegacyPartitioner: () => unknown;
  };
};

type KafkaProducerConfig = {
  createPartitioner?: () => unknown;
  retry?: {
    initialRetryTime?: number;
    retries?: number;
  };
};

@Injectable()
export class KafkaProducerService implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private producer: KafkaProducerLike | null = null;
  private kafkaConnected = false;
  private readonly kafkaEnabled = process.env.KAFKA_ENABLED === 'true';
  private readonly kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  private readonly kafkaTopic =
    process.env.KAFKA_TOPIC || 'data-vitrine.orders.generated';
  private readonly kafkaClientId =
    process.env.KAFKA_CLIENT_ID || 'data-vitrine-api';
  private readonly kafkaConnectionTimeoutMs = this.parsePositiveInt(
    process.env.KAFKA_CONNECTION_TIMEOUT_MS,
    3000,
  );
  private readonly kafkaRequestTimeoutMs = this.parsePositiveInt(
    process.env.KAFKA_REQUEST_TIMEOUT_MS,
    30000,
  );
  private readonly kafkaRetryInitialMs = this.parsePositiveInt(
    process.env.KAFKA_RETRY_INITIAL_MS,
    300,
  );
  private readonly kafkaRetries = this.parseNonNegativeInt(
    process.env.KAFKA_RETRIES,
    5,
  );

  async onModuleDestroy() {
    if (!this.producer || !this.kafkaConnected) {
      return;
    }

    try {
      await this.producer.disconnect();
    } catch (error) {
      this.logger.warn(`Kafka disconnect failed: ${String(error)}`);
    }
  }

  isEnabled(): boolean {
    return this.kafkaEnabled;
  }

  getTopic(): string {
    return this.kafkaTopic;
  }

  async publishGeneratedOrders(
    orders: any[],
    source = 'GET /data-vitrine/generate/kafka',
  ): Promise<void> {
    if (!this.kafkaEnabled || orders.length === 0) {
      return;
    }

    const publishedAt = new Date().toISOString();
    const producer = await this.getProducer();
    await producer.send({
      topic: this.kafkaTopic,
      messages: orders.map((order) => ({
        key: String(order?.id ?? order?.orderId ?? ''),
        value: JSON.stringify(order),
        headers: {
          source,
          publishedAt,
          payloadType: 'order',
        },
      })),
    });

    this.logger.log(
      `Published ${orders.length} orders to Kafka topic "${this.kafkaTopic}"`,
    );
  }

  private async getProducer(): Promise<KafkaProducerLike> {
    if (this.producer && this.kafkaConnected) {
      return this.producer;
    }

    const kafkajsModule = this.loadKafkaJs();
    const kafka = new kafkajsModule.Kafka({
      clientId: this.kafkaClientId,
      brokers: this.kafkaBrokers,
      connectionTimeout: this.kafkaConnectionTimeoutMs,
      requestTimeout: this.kafkaRequestTimeoutMs,
      retry: {
        initialRetryTime: this.kafkaRetryInitialMs,
        retries: this.kafkaRetries,
      },
    });

    this.producer = kafka.producer({
      createPartitioner: kafkajsModule.Partitioners.LegacyPartitioner,
      retry: {
        initialRetryTime: this.kafkaRetryInitialMs,
        retries: this.kafkaRetries,
      },
    });
    await this.producer.connect();
    this.kafkaConnected = true;
    this.logger.log(
      `Kafka producer connected to ${this.kafkaBrokers.join(', ')} (${this.kafkaTopic})`,
    );

    return this.producer;
  }

  private loadKafkaJs(): KafkaJsModule {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('kafkajs');
    } catch {
      throw new Error(
        'Kafka publishing is enabled, but package "kafkajs" is not installed. Run: npm install kafkajs',
      );
    }
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private parseNonNegativeInt(
    value: string | undefined,
    fallback: number,
  ): number {
    const parsed = parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
}
