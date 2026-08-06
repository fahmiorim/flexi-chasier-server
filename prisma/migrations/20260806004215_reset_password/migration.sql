-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kodeResetPasswordHash" TEXT,
ADD COLUMN     "kodeResetPasswordKadaluarsa" TIMESTAMP(3);
