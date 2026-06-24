-- Enable Row Level Security on every public table.
-- Why: Supabase auto-generates a PostgREST API reachable with the public anon key.
-- Without RLS, anyone holding that key can read AND write these tables, bypassing the backend.
-- The backend connects as the table-owner `postgres` role, which bypasses RLS, so these
-- policies only constrain the anon/authenticated auto-API — backend access is unaffected.

ALTER TABLE "images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "moodboard_folders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "moodboard_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- images: public read-only reference pool. Anyone may read; no write policy = no client writes.
CREATE POLICY "images_public_read" ON "images"
  FOR SELECT TO anon, authenticated USING (true);

-- profiles: a user sees and edits only their own row (profiles.id == auth user id).
CREATE POLICY "profiles_select_own" ON "profiles"
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON "profiles"
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- moodboard_folders: owner-only full access.
CREATE POLICY "folders_owner_all" ON "moodboard_folders"
  FOR ALL TO authenticated
  USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

-- moodboard_items: scoped through folder ownership.
CREATE POLICY "items_owner_all" ON "moodboard_items"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "moodboard_folders" f WHERE f.id = folder_id AND f.profile_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM "moodboard_folders" f WHERE f.id = folder_id AND f.profile_id = auth.uid()));

-- _prisma_migrations: internal Prisma table. RLS on, no policy = fully locked to the API.
-- (Backend/owner still bypasses RLS, so Prisma can keep recording migrations.)
