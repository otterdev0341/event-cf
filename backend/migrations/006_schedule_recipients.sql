ALTER TABLE schedules ADD COLUMN active_participant_ids jsonb NOT NULL DEFAULT '[]';
UPDATE schedules SET active_participant_ids=data->'participantIds' WHERE status='running';
