-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ProfileOnboardingStatus" AS ENUM ('not_started', 'dna_pending', 'completed');

-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "style_group" TEXT NOT NULL,
    "style" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "medium" TEXT,
    "sub_medium" TEXT,
    "color_palette" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "confidence" JSONB NOT NULL,
    "needs_review" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excluded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moodboard_folders" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "description" VARCHAR(160),
    "cover_image_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "moodboard_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moodboard_items" (
    "id" UUID NOT NULL,
    "folder_id" UUID NOT NULL,
    "image_id" TEXT NOT NULL,
    "note" VARCHAR(300),
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moodboard_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "username" VARCHAR(32),
    "display_name" VARCHAR(40),
    "avatar_url" TEXT,
    "bio" VARCHAR(160),
    "preferences" JSONB,
    "style_dna_result" JSONB,
    "onboarding_status" "ProfileOnboardingStatus" NOT NULL DEFAULT 'not_started',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_dna_results" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "primary_style" TEXT NOT NULL,
    "secondary_style" TEXT,
    "style_vector" JSONB NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "style_dna_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "images_style_group_idx" ON "images"("style_group");

-- CreateIndex
CREATE INDEX "images_medium_idx" ON "images"("medium");

-- CreateIndex
CREATE INDEX "images_sub_medium_idx" ON "images"("sub_medium");

-- CreateIndex
CREATE INDEX "moodboard_folders_profile_id_idx" ON "moodboard_folders"("profile_id");

-- CreateIndex
CREATE INDEX "moodboard_items_image_id_idx" ON "moodboard_items"("image_id");

-- CreateIndex
CREATE UNIQUE INDEX "moodboard_items_folder_id_image_id_key" ON "moodboard_items"("folder_id", "image_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_username_key" ON "profiles"("username");

-- CreateIndex
CREATE INDEX "style_dna_results_profile_id_created_at_idx" ON "style_dna_results"("profile_id", "created_at");

-- AddForeignKey
ALTER TABLE "moodboard_folders" ADD CONSTRAINT "moodboard_folders_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moodboard_items" ADD CONSTRAINT "moodboard_items_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "moodboard_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moodboard_items" ADD CONSTRAINT "moodboard_items_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_dna_results" ADD CONSTRAINT "style_dna_results_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
