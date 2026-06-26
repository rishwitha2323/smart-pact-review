
CREATE POLICY "own contract files read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'contracts' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own contract files insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'contracts' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own contract files delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'contracts' AND auth.uid()::text = (storage.foldername(name))[1]);
