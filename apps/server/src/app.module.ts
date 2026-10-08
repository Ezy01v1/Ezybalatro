import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { TablesModule } from './tables/tables.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    DbModule,
    TablesModule,
  ],
  controllers: [HealthController],
  providers: [RealtimeGateway],
})
export class AppModule {}
