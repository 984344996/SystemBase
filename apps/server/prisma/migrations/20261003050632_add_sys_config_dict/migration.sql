-- CreateTable
CREATE TABLE `sys_config` (
    `key` VARCHAR(100) NOT NULL,
    `value` VARCHAR(2000) NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'STRING',
    `group` VARCHAR(50) NOT NULL DEFAULT 'base',
    `label` VARCHAR(100) NOT NULL,
    `builtin` BOOLEAN NOT NULL DEFAULT false,
    `remark` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dict` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ENABLED',
    `remark` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dict_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dict_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dictId` INTEGER NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `value` VARCHAR(100) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ENABLED',
    `remark` VARCHAR(255) NULL,

    INDEX `dict_item_dictId_idx`(`dictId`),
    UNIQUE INDEX `dict_item_dictId_value_key`(`dictId`, `value`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `dict_item` ADD CONSTRAINT `dict_item_dictId_fkey` FOREIGN KEY (`dictId`) REFERENCES `dict`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
