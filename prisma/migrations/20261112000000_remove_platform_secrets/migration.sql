-- The platform import no longer authenticates to upstream APIs.
-- Keep the empty table for existing deployment rollback compatibility.
DELETE FROM "PlatformConnection";
