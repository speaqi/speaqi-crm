-- Prevent the same mailbox from being enrolled more than once in one campaign.
-- Contact import may retain shared addresses for review, but sending cannot.
create unique index if not exists commercial_enrollments_campaign_primary_email_unique
  on public.commercial_enrollments(campaign_id, lower(primary_email));

comment on index public.commercial_enrollments_campaign_primary_email_unique is
  'One primary recipient address per commercial campaign.';
