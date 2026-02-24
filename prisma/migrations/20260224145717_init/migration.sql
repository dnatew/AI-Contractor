-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "emailVerified" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "sqft" TEXT NOT NULL,
    "propertyType" TEXT,
    "notes" TEXT,
    "jobPrompt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "roomLabel" TEXT,
    "aiTags" JSONB,
    "aiConfidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Photo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScopeItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "laborHours" REAL,
    CONSTRAINT "ScopeItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EstimateLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "estimateId" TEXT NOT NULL,
    "scopeItemId" TEXT NOT NULL,
    "laborCost" REAL NOT NULL,
    "materialCost" REAL NOT NULL,
    "markup" REAL NOT NULL,
    "tax" REAL NOT NULL,
    CONSTRAINT "EstimateLine_scopeItemId_fkey" FOREIGN KEY ("scopeItemId") REFERENCES "ScopeItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EstimateLine_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalLabor" REAL NOT NULL,
    "totalMaterial" REAL NOT NULL,
    "totalMarkup" REAL NOT NULL,
    "totalTax" REAL NOT NULL,
    "grandTotal" REAL NOT NULL,
    "assumptions" JSONB,
    "generatedNarrative" TEXT,
    "exportedPdfUrl" TEXT,
    "sealedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Estimate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE INDEX "Photo_projectId_idx" ON "Photo"("projectId");

-- CreateIndex
CREATE INDEX "ScopeItem_projectId_idx" ON "ScopeItem"("projectId");

-- CreateIndex
CREATE INDEX "EstimateLine_estimateId_idx" ON "EstimateLine"("estimateId");

-- CreateIndex
CREATE INDEX "Estimate_projectId_idx" ON "Estimate"("projectId");

-- CreateIndex
CREATE INDEX "Estimate_projectId_status_idx" ON "Estimate"("projectId", "status");
