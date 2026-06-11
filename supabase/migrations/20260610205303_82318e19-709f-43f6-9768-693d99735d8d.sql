ALTER TABLE public.room_players DROP CONSTRAINT IF EXISTS room_players_pkey;

ALTER TABLE public.room_players ADD CONSTRAINT room_players_pkey PRIMARY KEY (user_id, room_id);

CREATE INDEX IF NOT EXISTS room_players_room_last_seen_idx ON public.room_players (room_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS room_players_user_room_idx ON public.room_players (user_id, room_id);