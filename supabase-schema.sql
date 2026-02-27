-- ============================================================
-- QuoteScout — Supabase Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. profiles table (linked to auth.users)
create table if not exists public.profiles (
  id                    uuid references auth.users(id) on delete cascade primary key,
  email                 text not null,
  usage_count           integer default 0 not null,
  is_subscribed         boolean default false not null,
  stripe_customer_id    text unique,
  stripe_subscription_id text,
  created_at            timestamptz default now() not null,
  updated_at            timestamptz default now() not null
);

-- 2. quote_generations table (history)
create table if not exists public.quote_generations (
  id           uuid default gen_random_uuid() primary key,
  user_id      uuid references public.profiles(id) on delete cascade not null,
  input_type   text not null check (input_type in ('book_title', 'text_snippet')),
  book_title   text,
  author       text,
  input_text   text,
  quotes_data  jsonb,
  created_at   timestamptz default now() not null
);

-- 3. Row Level Security
alter table public.profiles          enable row level security;
alter table public.quote_generations enable row level security;

-- profiles: users can read and update their own row
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- quote_generations: users can read/insert their own rows
create policy "Users can view own generations"
  on public.quote_generations for select
  using (auth.uid() = user_id);

create policy "Users can insert own generations"
  on public.quote_generations for insert
  with check (auth.uid() = user_id);

-- 4. Auto-create profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 5. Auto-update updated_at on profiles
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_profiles_updated_at on public.profiles;
create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.update_updated_at();
