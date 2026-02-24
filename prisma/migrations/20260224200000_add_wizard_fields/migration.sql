-- Add wizard fields to Project
ALTER TABLE "Project" ADD COLUMN "workTypes" TEXT;
ALTER TABLE "Project" ADD COLUMN "rooms" TEXT;
ALTER TABLE "Project" ADD COLUMN "materialGrade" TEXT;

-- Add user notes to Photo
ALTER TABLE "Photo" ADD COLUMN "userNotes" TEXT;
