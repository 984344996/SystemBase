-- DropForeignKey
ALTER TABLE `LoginLog` DROP FOREIGN KEY `LoginLog_userId_fkey`;

-- DropForeignKey
ALTER TABLE `OperateLog` DROP FOREIGN KEY `OperateLog_userId_fkey`;

-- DropForeignKey
ALTER TABLE `JobLog` DROP FOREIGN KEY `JobLog_jobId_fkey`;

-- DropTable
DROP TABLE `LoginLog`;

-- DropTable
DROP TABLE `OperateLog`;

-- DropTable
DROP TABLE `JobLog`;

