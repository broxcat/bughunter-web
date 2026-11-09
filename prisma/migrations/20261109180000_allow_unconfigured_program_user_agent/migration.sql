
-- The empty string represents an unconfigured User-Agent. Keep validation for
-- configured values and preserve every existing value.
ALTER TABLE "BountyProgram"
  DROP CONSTRAINT "BountyProgram_user_agent_valid",
  ADD CONSTRAINT "BountyProgram_user_agent_valid"
  CHECK ("requiredUserAgent" = '' OR (length(btrim("requiredUserAgent")) > 0 AND "requiredUserAgent" !~ '[^ -~]'));
