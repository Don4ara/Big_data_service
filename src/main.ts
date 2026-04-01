import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as os from 'os';
import * as cluster from 'cluster';

const clusterModule = cluster as any;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}

if (clusterModule.isPrimary || clusterModule.isMaster) {
  const numCPUs = Math.min(os.cpus().length, 2);
  console.log(`Primary process ${process.pid} is running`);

  for (let i = 0; i < numCPUs; i++) {
    clusterModule.fork();
  }

  clusterModule.on('exit', (worker, code, signal) => {
    console.log(`Worker process ${worker.process.pid} died. Restarting...`);
    clusterModule.fork();
  });
} else {
  bootstrap();
  console.log(`Worker process ${process.pid} started`);
}
