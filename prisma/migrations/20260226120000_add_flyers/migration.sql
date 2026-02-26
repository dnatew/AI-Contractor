-- Add flyer library tables (user-wide)
CREATE TABLE "Flyer" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "storeName" TEXT,
  "releaseDate" TIMESTAMP(3),
  "parsedSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Flyer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FlyerItem" (
  "id" TEXT NOT NULL,
  "flyerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "unitLabel" TEXT,
  "price" DOUBLE PRECISION NOT NULL,
  "promoNotes" TEXT,
  "rawText" TEXT,
  "normalizedTokens" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FlyerItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Flyer"
ADD CONSTRAINT "Flyer_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FlyerItem"
ADD CONSTRAINT "FlyerItem_flyerId_fkey"
FOREIGN KEY ("flyerId") REFERENCES "Flyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Flyer_userId_releaseDate_idx" ON "Flyer"("userId", "releaseDate");
CREATE INDEX "Flyer_userId_createdAt_idx" ON "Flyer"("userId", "createdAt");
CREATE INDEX "FlyerItem_flyerId_idx" ON "FlyerItem"("flyerId");
CREATE INDEX "FlyerItem_name_idx" ON "FlyerItem"("name");
CREATE INDEX "FlyerItem_normalizedTokens_gin_idx" ON "FlyerItem" USING GIN ("normalizedTokens");
