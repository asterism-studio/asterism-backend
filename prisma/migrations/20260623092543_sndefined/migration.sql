-- DropForeignKey
ALTER TABLE "style_dna_results" DROP CONSTRAINT "style_dna_results_profile_id_fkey";

-- DropTable
DROP TABLE "style_dna_results";

-- AlterTable
ALTER TABLE "images" DROP COLUMN "source";
