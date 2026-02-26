-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "sqft" TEXT NOT NULL,
    "propertyType" TEXT,
    "neighborhoodTier" TEXT,
    "addressDetails" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "workTypes" TEXT,
    "rooms" TEXT,
    "materialGrade" TEXT,
    "notes" TEXT,
    "jobPrompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlipSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT,
    "purchasePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "renoCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "holdingMonths" INTEGER NOT NULL DEFAULT 0,
    "monthlyMortgage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyTaxes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyInsurance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyUtilities" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "realtorPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "legalFees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "staging" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userNotes" TEXT,
    "aiReasoning" TEXT,
    "comparablesFound" TEXT,
    "marketType" TEXT,
    "roiPatternJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlipSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "roomLabel" TEXT,
    "userNotes" TEXT,
    "aiTags" JSONB,
    "aiConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scope" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Scope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeItem" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "laborHours" DOUBLE PRECISION,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ScopeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateLine" (
    "id" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "scopeItemId" TEXT NOT NULL,
    "laborCost" DOUBLE PRECISION NOT NULL,
    "materialCost" DOUBLE PRECISION NOT NULL,
    "markup" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL,
    "laborHours" DOUBLE PRECISION,
    "laborRate" DOUBLE PRECISION,
    "materialUnitCost" DOUBLE PRECISION,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "materialName" TEXT,
    "pricingSource" TEXT,

    CONSTRAINT "EstimateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalLabor" DOUBLE PRECISION NOT NULL,
    "totalMaterial" DOUBLE PRECISION NOT NULL,
    "totalMarkup" DOUBLE PRECISION NOT NULL,
    "totalTax" DOUBLE PRECISION NOT NULL,
    "grandTotal" DOUBLE PRECISION NOT NULL,
    "confirmedAmount" DOUBLE PRECISION,
    "assumptions" JSONB,
    "generatedNarrative" TEXT,
    "exportedPdfUrl" TEXT,
    "sealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPricing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'sqft',

    CONSTRAINT "UserPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProperty" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "purchasePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "purchaseDate" TEXT,
    "salePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "saleDate" TEXT,
    "sqft" INTEGER NOT NULL DEFAULT 0,
    "features" TEXT NOT NULL DEFAULT '',
    "renoWork" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProperty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "FlipSearch_userId_projectId_idx" ON "FlipSearch"("userId", "projectId");

-- CreateIndex
CREATE INDEX "FlipSearch_projectId_createdAt_idx" ON "FlipSearch"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Photo_projectId_idx" ON "Photo"("projectId");

-- CreateIndex
CREATE INDEX "Scope_projectId_idx" ON "Scope"("projectId");

-- CreateIndex
CREATE INDEX "ScopeItem_scopeId_idx" ON "ScopeItem"("scopeId");

-- CreateIndex
CREATE INDEX "EstimateLine_estimateId_idx" ON "EstimateLine"("estimateId");

-- CreateIndex
CREATE INDEX "Estimate_projectId_idx" ON "Estimate"("projectId");

-- CreateIndex
CREATE INDEX "Estimate_projectId_status_idx" ON "Estimate"("projectId", "status");

-- CreateIndex
CREATE INDEX "UserPricing_userId_idx" ON "UserPricing"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPricing_userId_key_key" ON "UserPricing"("userId", "key");

-- CreateIndex
CREATE INDEX "UserProperty_userId_idx" ON "UserProperty"("userId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlipSearch" ADD CONSTRAINT "FlipSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlipSearch" ADD CONSTRAINT "FlipSearch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scope" ADD CONSTRAINT "Scope_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeItem" ADD CONSTRAINT "ScopeItem_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "Scope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLine" ADD CONSTRAINT "EstimateLine_scopeItemId_fkey" FOREIGN KEY ("scopeItemId") REFERENCES "ScopeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLine" ADD CONSTRAINT "EstimateLine_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPricing" ADD CONSTRAINT "UserPricing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProperty" ADD CONSTRAINT "UserProperty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
