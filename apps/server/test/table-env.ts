/**
 * Fast table timings for the table e2e suite. Import this BEFORE `AppModule`: `ConfigModule.forRoot`
 * validates the environment when the module file is imported.
 */
Object.assign(process.env, {
  BETWEEN_HANDS_MS: '100',
  BOT_DELAY_MIN_MS: '10',
  BOT_DELAY_MAX_MS: '30',
  TURN_TIMEOUT_MS: '3000',
  DISCONNECT_GRACE_MS: '1000',
  EMPTY_TABLE_CLOSE_MS: '500',
});
