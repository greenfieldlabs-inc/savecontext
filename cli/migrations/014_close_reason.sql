-- Add close_reason column to issues table for tracking why issues were closed
ALTER TABLE issues ADD COLUMN close_reason TEXT;
