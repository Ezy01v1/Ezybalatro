import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { HealthController } from './health/health.controller';
import { RealtimeGateway } from './realtime/realtime.gateway';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv })],
  controllers: [HealthController],
  providers: [RealtimeGateway],
})
export class AppModule {}
