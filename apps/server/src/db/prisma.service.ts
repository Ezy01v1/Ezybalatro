import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/** DI token for the database URL; the service never reads process.env itself. */
export const DATABASE_URL = Symbol('DATABASE_URL');
/** DI token for the max size of the pg pool (`DATABASE_POOL_MAX`). */
export const DATABASE_POOL_MAX = Symbol('DATABASE_POOL_MAX');

/**
 * The Prisma client as a Nest provider. It disconnects in `DbModule.onApplicationShutdown`, not in
 * `onModuleDestroy`: Nest runs `onModuleDestroy` before `beforeApplicationShutdown`, where the
 * tables still cash everybody out.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor(
    @Inject(DATABASE_URL) connectionString: string,
    @Inject(DATABASE_POOL_MAX) max: number,
  ) {
    super({ adapter: new PrismaPg({ connectionString, max }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
}
