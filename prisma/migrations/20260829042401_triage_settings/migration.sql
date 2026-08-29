-- CreateEnum
CREATE TYPE "UnknownDiagnosisBehavior" AS ENUM ('YELLOW', 'UNKNOWN');

-- AlterTable
ALTER TABLE "organization_settings" ADD COLUMN     "confidenceBands" JSONB,
ADD COLUMN     "contestedMargin" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "diagnosisConfidenceFloor" INTEGER NOT NULL DEFAULT 55,
ADD COLUMN     "unknownDiagnosisBehavior" "UnknownDiagnosisBehavior" NOT NULL DEFAULT 'YELLOW';
