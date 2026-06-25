-- images：僅 admin 可 UPDATE（讀沿用 images_public_read）。
-- 審核工具(#81)寫入 approve/correct/exclude 走 anon/authenticated 的 PostgREST，
-- 由此 policy 確保只有 is_admin 的使用者能改 images。
CREATE POLICY "images_admin_update" ON "images"
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));

-- 鎖住自我提權：即使 profiles_update_own 也改不動 is_admin。
-- 設 admin 走 owner/service role 連線繞 RLS，不受此限制。
REVOKE UPDATE ("is_admin") ON public.profiles FROM authenticated, anon;
