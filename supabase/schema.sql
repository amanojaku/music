-- Run in the Supabase SQL editor when you're ready to connect.
create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  genre text,
  duration_seconds integer not null,
  released_at date not null default current_date,
  audio_path text not null,          -- streaming copy (e.g. AAC) in the "tracks" storage bucket
  download_path text,                -- full-quality file for downloads (e.g. WAV); falls back to audio_path
  cover_path text,                   -- square cover image in storage
  key_tonic text check (key_tonic ~ '^[A-G][#b]?$'),   -- e.g. 'G', 'F#', 'Bb'
  key_mode text check (key_mode in ('major', 'minor')),
  tuning text[] check (tuning is null or array_length(tuning, 1) = 6),  -- low → high, e.g. {E2,A2,E3,G3,B3,E4}; null = standard
  notation_path text,                -- MusicXML score in storage
  sync_path text,                    -- JSON sync points: [{barIndex, barPosition, barOccurence, millisecondOffset}]
  created_at timestamptz not null default now()
);

alter table public.tracks enable row level security;

create policy "Tracks are publicly readable"
  on public.tracks for select using (true);
