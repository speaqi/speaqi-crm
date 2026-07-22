alter table public.user_settings
add column if not exists email_goal text,
add column if not exists email_strategy text,
add column if not exists email_positioning text,
add column if not exists email_do_not_say text;
