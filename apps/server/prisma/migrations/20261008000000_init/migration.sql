-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ledger_reason" AS ENUM ('initial', 'daily_refill', 'buy_in', 'cash_out', 'recovery_cash_out', 'bot_buy_in', 'bot_cash_out');

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "dev_handle" TEXT,
    "nickname" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "user_id" UUID NOT NULL,
    "balance" BIGINT NOT NULL,
    "last_daily_refill_at" TIMESTAMPTZ(3),

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "chip_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "delta" BIGINT NOT NULL,
    "balance_after" BIGINT,
    "reason" "ledger_reason" NOT NULL,
    "table_id" UUID,
    "hand_id" UUID,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chip_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tables" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "max_seats" INTEGER NOT NULL,
    "small_blind" BIGINT NOT NULL,
    "big_blind" BIGINT NOT NULL,
    "min_buy_in" BIGINT NOT NULL,
    "max_buy_in" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seats" (
    "id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "seat_index" INTEGER NOT NULL,
    "user_id" UUID,
    "bot_name" TEXT,
    "stack" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hands" (
    "id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "hand_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "button_seat" INTEGER NOT NULL,
    "board" JSONB NOT NULL,
    "awards" JSONB NOT NULL,
    "shown_hands" JSONB NOT NULL,
    "settled_at" TIMESTAMPTZ(3),

    CONSTRAINT "hands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hand_actions" (
    "id" UUID NOT NULL,
    "hand_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "seat_index" INTEGER NOT NULL,
    "street" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" BIGINT,

    CONSTRAINT "hand_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_dev_handle_key" ON "profiles"("dev_handle");

-- CreateIndex
CREATE INDEX "chip_ledger_user_id_created_at_idx" ON "chip_ledger"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "seats_user_id_idx" ON "seats"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "seats_table_id_seat_index_key" ON "seats"("table_id", "seat_index");

-- CreateIndex
CREATE UNIQUE INDEX "hands_table_id_hand_number_key" ON "hands"("table_id", "hand_number");

-- CreateIndex
CREATE UNIQUE INDEX "hand_actions_hand_id_seq_key" ON "hand_actions"("hand_id", "seq");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chip_ledger" ADD CONSTRAINT "chip_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seats" ADD CONSTRAINT "seats_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seats" ADD CONSTRAINT "seats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hands" ADD CONSTRAINT "hands_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hand_actions" ADD CONSTRAINT "hand_actions_hand_id_fkey" FOREIGN KEY ("hand_id") REFERENCES "hands"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: constraints Prisma cannot model (spec §2, invariants 1 and 7).
-- ---------------------------------------------------------------------------

ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_non_negative" CHECK ("balance" >= 0);

ALTER TABLE "chip_ledger" ADD CONSTRAINT "chip_ledger_delta_non_zero" CHECK ("delta" <> 0);

-- Idempotency only applies when a key is given; the house (user_id NULL) shares one key space.
CREATE UNIQUE INDEX "chip_ledger_user_id_idempotency_key_key" ON "chip_ledger"("user_id", "idempotency_key") NULLS NOT DISTINCT
    WHERE "idempotency_key" IS NOT NULL;

ALTER TABLE "tables" ADD CONSTRAINT "tables_max_seats_range" CHECK ("max_seats" BETWEEN 2 AND 6);

ALTER TABLE "seats" ADD CONSTRAINT "seats_stack_non_negative" CHECK ("stack" >= 0);
ALTER TABLE "seats" ADD CONSTRAINT "seats_exactly_one_occupant" CHECK (("user_id" IS NULL) <> ("bot_name" IS NULL));

-- Row level security on, no policies: clients never access the database directly (ADR 0005).
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chip_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "seats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hand_actions" ENABLE ROW LEVEL SECURITY;
