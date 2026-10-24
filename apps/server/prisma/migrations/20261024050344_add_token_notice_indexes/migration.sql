-- CreateIndex
CREATE INDEX `RefreshToken_expiresAt_idx` ON `RefreshToken`(`expiresAt`);

-- CreateIndex
CREATE INDEX `RefreshToken_revokedAt_idx` ON `RefreshToken`(`revokedAt`);

-- CreateIndex
CREATE INDEX `notice_status_top_createdAt_idx` ON `notice`(`status`, `top`, `createdAt`);
