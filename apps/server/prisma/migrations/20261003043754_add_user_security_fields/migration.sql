-- AlterTable
ALTER TABLE `User` ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pwdUpdatedAt` DATETIME(3) NULL;
