CREATE TABLE public.room_tables (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id text NOT NULL,
  creator_id uuid NOT NULL,
  creator_username text NOT NULL,
  name text NOT NULL,
  subject text NOT NULL,
  goal text,
  duration_minutes integer NOT NULL DEFAULT 25,
  x double precision NOT NULL,
  y double precision NOT NULL,
  max_seats integer NOT NULL DEFAULT 4,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '8 hours')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_tables TO authenticated;
GRANT ALL ON public.room_tables TO service_role;

ALTER TABLE public.room_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view tables"
  ON public.room_tables FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create tables"
  ON public.room_tables FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creators can update their tables"
  ON public.room_tables FOR UPDATE
  TO authenticated
  USING (auth.uid() = creator_id)
  WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creators can delete their tables"
  ON public.room_tables FOR DELETE
  TO authenticated
  USING (auth.uid() = creator_id);

CREATE INDEX room_tables_room_idx ON public.room_tables (room_id);
CREATE INDEX room_tables_expires_idx ON public.room_tables (expires_at);

ALTER PUBLICATION supabase_realtime ADD TABLE public.room_tables;