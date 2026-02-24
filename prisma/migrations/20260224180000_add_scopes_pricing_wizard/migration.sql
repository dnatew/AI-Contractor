-- CreateTable Scope
CREATE TABLE "Scope" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Scope_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Scope_projectId_idx" ON "Scope"("projectId");

-- CreateTable UserPricing
CREATE TABLE "UserPricing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'sqft',
    CONSTRAINT "UserPricing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserPricing_userId_key_key" ON "UserPricing"("userId", "key");
CREATE INDEX "UserPricing_userId_idx" ON "UserPricing"("userId");

-- Add columns to Project
ALTER TABLE "Project" ADD COLUMN "neighborhoodTier" TEXT;
ALTER TABLE "Project" ADD COLUMN "addressDetails" TEXT;

-- Add column to Estimate
ALTER TABLE "Estimate" ADD COLUMN "confirmedAmount" REAL;

-- Create default Scope for each project that has ScopeItems, then migrate ScopeItems
INSERT INTO "Scope" ("id", "projectId", "name", "description", "order")
SELECT 
  'scope_' || "projectId",
  "projectId",
  'Main',
  'Default scope',
  0
FROM (SELECT DISTINCT "projectId" FROM "ScopeItem");

-- Create new ScopeItem table with scopeId
CREATE TABLE "ScopeItem_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeId" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "laborHours" REAL,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ScopeItem_new_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "Scope" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "ScopeItem_new" ("id", "scopeId", "segment", "task", "material", "quantity", "unit", "source", "laborHours", "progressPercent")
SELECT si."id", 'scope_' || si."projectId", si."segment", si."task", si."material", si."quantity", si."unit", si."source", si."laborHours", 0
FROM "ScopeItem" si;

DROP TABLE "ScopeItem";
ALTER TABLE "ScopeItem_new" RENAME TO "ScopeItem";
CREATE INDEX "ScopeItem_scopeId_idx" ON "ScopeItem"("scopeId");
