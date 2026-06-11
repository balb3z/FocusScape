
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  avatar_id INT NOT NULL DEFAULT 0,
  avatar_url TEXT,
  total_focus_minutes INT NOT NULL DEFAULT 0,
  current_streak INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE TABLE public.focus_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  duration_minutes INT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.focus_sessions TO authenticated;
GRANT ALL ON public.focus_sessions TO service_role;
ALTER TABLE public.focus_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sessions viewable by everyone" ON public.focus_sessions FOR SELECT USING (true);
CREATE POLICY "Users manage own sessions" ON public.focus_sessions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_id, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1),
      'student'
    ),
    COALESCE((NEW.raw_user_meta_data->>'avatar_id')::int, floor(random() * 6)::int),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'
    )
  );
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.room_players (
  user_id UUID NOT NULL,
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
  PRIMARY KEY (user_id, room_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_players TO authenticated;
GRANT ALL ON public.room_players TO service_role;

ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players can view shared room state" ON public.room_players FOR SELECT TO authenticated USING (true);
CREATE POLICY "Players can join as themselves" ON public.room_players FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Players can update their own live state" ON public.room_players FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Players can leave as themselves" ON public.room_players FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.room_players;
ALTER TABLE public.room_players REPLICA IDENTITY FULL;

CREATE INDEX IF NOT EXISTS room_players_room_last_seen_idx ON public.room_players (room_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS room_players_user_room_idx ON public.room_players (user_id, room_id);
