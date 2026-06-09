-- Email drafts table for automated draft generation with human-in-the-loop approval
CREATE TABLE IF NOT EXISTS email_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  gmail_draft_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'dismissed')),
  source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE email_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_drafts_owner" ON email_drafts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_email_drafts_user_status   ON email_drafts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_email_drafts_contact       ON email_drafts(contact_id);
CREATE INDEX IF NOT EXISTS idx_email_drafts_created       ON email_drafts(created_at DESC);
