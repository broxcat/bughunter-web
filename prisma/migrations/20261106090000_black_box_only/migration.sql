-- Retire current configuration, preserving all immutable historical snapshots.
UPDATE "BountyProgram" SET "assessmentMode" = 'BLACK_BOX' WHERE "assessmentMode" = 'WHITE_BOX';
UPDATE "AssessmentSource" SET "active" = false WHERE "active" = true;
ALTER TABLE "BountyProgram" ADD CONSTRAINT "BountyProgram_black_box_only" CHECK ("assessmentMode" = 'BLACK_BOX');
ALTER TABLE "AssessmentSource" ADD CONSTRAINT "AssessmentSource_retired" CHECK ("active" = false);
ALTER TABLE "AssessmentSource" ALTER COLUMN "active" SET DEFAULT false;
