-- Existing listings collected water prices as a per-person amount; record that unit explicitly.
UPDATE listing_drafts
 SET details=json_set(details,'$.water_unit','per_person')
 WHERE json_valid(details) AND json_type(details,'$.water_unit') IS NULL;

UPDATE listing_drafts
 SET public_data=json_set(public_data,'$.water_unit','per_person')
 WHERE public_data IS NOT NULL AND json_valid(public_data) AND json_type(public_data,'$.water_unit') IS NULL;
