-- Run in the Supabase SQL editor when you're ready to connect.
create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  genre text,
  duration_seconds integer not null,
  released_at date not null default current_date,
  audio_path text not null,          -- key in the "tracks" storage bucket
  cover_url text,
  download_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.tracks enable row level security;

create policy "Tracks are publicly readable"
  on public.tracks for select using (true);

-- Atomic counter, callable from the server with the service role key.
create or replace function public.increment_download_count(track_id uuid)
returns void language sql security definer as $$
  update public.tracks set download_count = download_count + 1 where id = track_id;
$$;
