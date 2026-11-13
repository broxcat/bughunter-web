-- Policy metadata remains available for request limits, exclusions and audit,
-- but policy review state no longer gates the automated campaign workflow.
-- Recover campaigns left blocked by the former gate without touching genuine
-- scope, deletion or runtime failures.
UPDATE "TargetCampaign"
SET
  "state" = 'READY',
  "reason" = NULL,
  "requestedAt" = CURRENT_TIMESTAMP,
  "nextCycleAt" = NULL,
  "retryAt" = NULL,
  "continuing" = FALSE,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "state" = 'BLOCKED'
  AND (
    "reason" LIKE 'Automation is blocked%'
    OR "reason" = 'Confirm an execution policy that allows automation in Target settings.'
    OR "reason" = 'The program policy does not allow automation.'
    OR "reason" = 'Program identification requires a hunter username. Configure HUNTER_USERNAME before automation can run.'
    OR "reason" = 'Recon requires a User-Agent. Set the program User-Agent in Target settings or configure DEFAULT_USER_AGENT.'
    OR "reason" = 'Resolved required headers are invalid. Check the program policy and HUNTER_USERNAME.'
    OR "reason" = 'Invalid program execution policy'
    OR "reason" = 'Platform rules need review.'
  );
