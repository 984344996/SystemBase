-- RefreshToken 增加登录会话字段（B2 绝对过期上限 / B3 登出即时吊销 accessToken）
--   sessionId：一次登录产生，轮换时沿用；accessToken 的 sid 声明与之对应
--   sessionStartedAt：会话开始时间，轮换不重置，用于 JWT_REFRESH_ABSOLUTE_MAX

-- 1. 先带默认值加列，存量记录才能通过 NOT NULL
ALTER TABLE `RefreshToken` ADD COLUMN `sessionId` VARCHAR(32) NOT NULL DEFAULT '',
    ADD COLUMN `sessionStartedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- 2. 存量回填：每条旧记录各自成为一个会话，会话开始时间取签发时间（旧 accessToken 不带 sid，不受影响）
UPDATE `RefreshToken` SET `sessionId` = CONCAT('legacy', `id`), `sessionStartedAt` = `createdAt`;

-- 3. 去掉 sessionId 的临时默认值，与 schema.prisma 保持一致（否则下次 migrate diff 会出现漂移）
ALTER TABLE `RefreshToken` ALTER COLUMN `sessionId` DROP DEFAULT;

-- CreateIndex
CREATE INDEX `RefreshToken_sessionId_idx` ON `RefreshToken`(`sessionId`);
