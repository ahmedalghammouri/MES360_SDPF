-- Ensure the UserRole enum exists. Earlier migrations created users.role as TEXT and
-- never defined this type, so dashboard_permissions.role below would fail. Guarded so it
-- is a no-op when the type already exists (idempotent for retry / migrate reset).
DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM (
    'SUPER_ADMIN', 'FACTORY_ADMIN', 'PLANT_MANAGER', 'PRODUCTION_MANAGER', 'PRODUCTION_SUPERVISOR',
    'QUALITY_MANAGER', 'QUALITY_ENGINEER', 'MAINTENANCE_MANAGER', 'MAINTENANCE_TECHNICIAN',
    'ENERGY_MANAGER', 'OPERATOR', 'VIEWER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
CREATE TYPE "DashboardSource" AS ENUM ('MES360_NATIVE', 'GRAFANA', 'REPORT', 'EXTERNAL', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "DashboardType" AS ENUM ('OPERATIONAL', 'KPI', 'ANALYTICS', 'REPORT', 'EXECUTIVE', 'ENERGY', 'QUALITY', 'MAINTENANCE', 'PRODUCTION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DashboardVisibility" AS ENUM ('PRIVATE', 'FACTORY', 'ENTERPRISE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "DashboardPermissionLevel" AS ENUM ('VIEW', 'EDIT', 'MANAGE');

-- CreateTable
CREATE TABLE "dashboard_categories" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboards" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT,
    "enterpriseId" TEXT,
    "categoryId" TEXT,
    "slug" TEXT,
    "title" TEXT NOT NULL,
    "titleAr" TEXT,
    "description" TEXT,
    "source" "DashboardSource" NOT NULL DEFAULT 'MES360_NATIVE',
    "type" "DashboardType" NOT NULL DEFAULT 'OPERATIONAL',
    "visibility" "DashboardVisibility" NOT NULL DEFAULT 'FACTORY',
    "route" TEXT,
    "externalUrl" TEXT,
    "grafanaUid" TEXT,
    "grafanaSlug" TEXT,
    "grafanaOrgId" INTEGER,
    "grafanaFolder" TEXT,
    "icon" TEXT,
    "thumbnailUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isFactoryAware" BOOLEAN NOT NULL DEFAULT true,
    "supportedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultTimeRange" TEXT DEFAULT 'now-24h',
    "refreshInterval" TEXT DEFAULT '30s',
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "templateOfId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_favorites" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_permissions" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "role" "UserRole",
    "userId" TEXT,
    "level" "DashboardPermissionLevel" NOT NULL DEFAULT 'VIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dashboard_categories_factoryId_idx" ON "dashboard_categories"("factoryId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_categories_factoryId_key_key" ON "dashboard_categories"("factoryId", "key");

-- CreateIndex
CREATE INDEX "dashboards_factoryId_source_idx" ON "dashboards"("factoryId", "source");

-- CreateIndex
CREATE INDEX "dashboards_categoryId_idx" ON "dashboards"("categoryId");

-- CreateIndex
CREATE INDEX "dashboards_type_idx" ON "dashboards"("type");

-- CreateIndex
CREATE INDEX "dashboards_isTemplate_idx" ON "dashboards"("isTemplate");

-- CreateIndex
CREATE INDEX "dashboard_favorites_userId_idx" ON "dashboard_favorites"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_favorites_dashboardId_userId_key" ON "dashboard_favorites"("dashboardId", "userId");

-- CreateIndex
CREATE INDEX "dashboard_permissions_dashboardId_idx" ON "dashboard_permissions"("dashboardId");

-- CreateIndex
CREATE INDEX "dashboard_permissions_userId_idx" ON "dashboard_permissions"("userId");

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "dashboard_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_favorites" ADD CONSTRAINT "dashboard_favorites_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_permissions" ADD CONSTRAINT "dashboard_permissions_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

