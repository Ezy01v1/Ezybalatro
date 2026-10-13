-- AlterEnum
ALTER TYPE "ledger_reason" ADD VALUE 'account_deleted';

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN "avatar_id" TEXT,
ADD COLUMN "deleted_at" TIMESTAMPTZ(3),
ALTER COLUMN "nickname" DROP NOT NULL;

-- Fix-up of existing rows (after DROP NOT NULL so NULL is allowed): nicknames that do not fit
-- the new format would break the CHECK below.
UPDATE "profiles" SET "nickname" = NULL WHERE "nickname" !~ '^[A-Za-z0-9_]{3,20}$';

-- Duplicate nicknames would break the unique index below: keep the oldest profile's, clear the rest.
UPDATE "profiles" p SET "nickname" = NULL
WHERE p."nickname" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "profiles" o
    WHERE o."nickname" = p."nickname"
      AND (o."created_at", o."id") < (p."created_at", p."id")
  );

-- Hand-written: nickname format (3-20 of [A-Za-z0-9_]) when set.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_nickname_format_check"
  CHECK ("nickname" IS NULL OR "nickname" ~ '^[A-Za-z0-9_]{3,20}$');

-- Hand-written: unique nickname among live profiles only.
CREATE UNIQUE INDEX "profiles_nickname_live_key" ON "profiles" ("nickname")
  WHERE "deleted_at" IS NULL AND "nickname" IS NOT NULL;
