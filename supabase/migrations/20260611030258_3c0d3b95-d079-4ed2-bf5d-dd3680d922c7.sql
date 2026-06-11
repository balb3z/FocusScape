
ALTER TABLE public.room_players ADD COLUMN IF NOT EXISTS seat_index INT;
CREATE UNIQUE INDEX IF NOT EXISTS room_players_seat_unique
  ON public.room_players (room_id, table_id, seat_index)
  WHERE seat_index IS NOT NULL AND table_id IS NOT NULL;
