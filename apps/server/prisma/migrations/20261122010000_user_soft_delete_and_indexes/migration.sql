-- 用户软删除后可重建同名账号（B9）+ 列表常用查询索引（B12）

-- 1. username 列放宽到 80：软删除时改写为「原名#del<id>」（输入最长仍为 50）
ALTER TABLE `User` MODIFY `username` VARCHAR(80) NOT NULL;

-- 2. 存量：已软删除的账号释放原用户名（之后可以新建同名账号）
UPDATE `User` SET `username` = CONCAT(`username`, '#del', `id`)
WHERE `deletedAt` IS NOT NULL AND `username` NOT LIKE '%#del%';

-- 3. 用户列表：未删除 + 状态筛选 + 按创建时间排序
CREATE INDEX `User_deletedAt_status_createdAt_idx` ON `User`(`deletedAt`, `status`, `createdAt`);

-- 4. 文件列表：未删除 + 按创建时间倒序（组合索引的前缀同样覆盖只按 deletedAt 的清理查询，单列索引可删）
CREATE INDEX `file_deletedAt_createdAt_idx` ON `file`(`deletedAt`, `createdAt`);
DROP INDEX `file_deletedAt_idx` ON `file`;
