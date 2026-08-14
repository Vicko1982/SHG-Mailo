alter table public.profiles
  add column if not exists voice_names text[] not null default '{}',
  add column if not exists aliases text[] not null default '{}';

comment on column public.profiles.voice_names is 'Spoken name variants used by Mailo voice tools.';
comment on column public.profiles.aliases is 'Additional user aliases used for matching and display.';
