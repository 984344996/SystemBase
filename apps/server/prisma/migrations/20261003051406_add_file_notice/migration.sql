-- CreateTable
CREATE TABLE `file` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `uploaderId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    INDEX `file_uploaderId_idx`(`uploaderId`),
    INDEX `file_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `content` TEXT NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'NOTICE',
    `top` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `startAt` DATETIME(3) NULL,
    `endAt` DATETIME(3) NULL,
    `publisherId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `notice_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notice_read` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `noticeId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `readAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notice_read_userId_idx`(`userId`),
    UNIQUE INDEX `notice_read_noticeId_userId_key`(`noticeId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notice_read` ADD CONSTRAINT `notice_read_noticeId_fkey` FOREIGN KEY (`noticeId`) REFERENCES `notice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
