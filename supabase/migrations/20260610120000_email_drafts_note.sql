-- Add note column to email_drafts for per-draft context/instructions
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS note TEXT;
