import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv, type Env } from './config/env';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { MeModule } from './me/me.module';
import { loggerParams } from './observability/logger';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { TablesModule } from './tables/tables.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => loggerParams(config.get('LOG_LEVEL', { infer: true })),
    }),
    DbModule,
    TablesModule,
    MeModule,
  ],
  controllers: [HealthController],
  providers: [RealtimeGateway],
})
export class AppModule {}
