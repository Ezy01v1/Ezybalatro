-- Supabase Auth user of a deleted profile removed (NULL = still to do, retried at startup).
ALTER TABLE "profiles" ADD COLUMN "auth_deleted_at" TIMESTAMPTZ(3);
