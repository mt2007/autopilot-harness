-- Pending followup redelivery (Cursor may drop stop followups).
ALTER TABLE review_chains ADD COLUMN pending_followup TEXT;
ALTER TABLE review_chains ADD COLUMN pending_followup_at TEXT;
ALTER TABLE review_chains ADD COLUMN pending_redeliver_at TEXT;
