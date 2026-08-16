alter table public.user_settings
add column if not exists email_high_interest_segment text;
