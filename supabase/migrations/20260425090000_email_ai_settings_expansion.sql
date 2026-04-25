alter table public.user_settings
add column if not exists email_target_audience text,
add column if not exists email_value_proposition text,
add column if not exists email_offer_details text,
add column if not exists email_proof_points text,
add column if not exists email_objection_notes text,
add column if not exists email_call_to_action text;
