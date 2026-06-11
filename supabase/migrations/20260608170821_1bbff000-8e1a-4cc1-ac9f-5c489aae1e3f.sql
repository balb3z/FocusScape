CREATE TABLE public.room_players (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  username TEXT NOT NULL,
  avatar_id INTEGER NOT NULL DEFAULT 0,
  avatar_url TEXT,
  x DOUBLE PRECISION NOT NULL DEFAULT 800,
  y DOUBLE PRECISION NOT NULL DEFAULT 600,
  animation_state TEXT NOT NULL DEFAULT 'idle' CHECK (animation_state IN ('idle', 'walking', 'focused')),
  table_id TEXT,
  focus_status TEXT NOT NULL DEFAULT 'idle' CHECK (focus_status IN ('idle', 'focused')),
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_players TO authenticated;
GRANT ALL ON public.room_players TO service_role;

ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players can view shared room state"
ON public.room_players
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Players can join as themselves"
ON public.room_players
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Players can update their own live state"
ON public.room_players
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Players can leave as themselves"
ON public.room_players
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.room_players;