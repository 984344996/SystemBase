.PHONY: install dev build test lint db-deploy db-migrate db-push db-seed db-studio local local-fresh local-stop local-status pre release deploy deploy-status up up-redis down logs

install:            ## 安装全部依赖
	pnpm install

dev:                ## 并行启动前后端(热更新)
	pnpm dev

build:              ## 构建全部包
	pnpm build

test:               ## 运行后端单测
	pnpm test

lint:               ## 全包类型检查 + schema 校验
	pnpm lint

db-deploy:          ## 应用全部未执行的迁移(新库初始化 / 拉取新代码后执行，与生产一致)
	pnpm --filter @sb/server prisma:deploy

db-migrate:         ## 修改 schema.prisma 后生成并应用新迁移：make db-migrate name=add_xxx
	pnpm --filter @sb/server exec prisma migrate dev --name $(or $(name),change)

db-push:            ## 仅原型阶段快速同步 schema(不生成迁移，勿用于共享/生产库)
	pnpm --filter @sb/server prisma:push

db-seed:            ## 初始化种子数据(超管/角色/菜单，幂等)
	pnpm --filter @sb/server prisma:seed

db-studio:          ## 打开 Prisma Studio
	pnpm --filter @sb/server prisma:studio

local:              ## 本地一键启动/重启（迁移 + 种子 + 前后端后台运行；配置 deploy/envs/local.env）
	bash ./sb.sh local

local-fresh:        ## 本地清空数据库后重建并启动
	bash ./sb.sh local fresh

local-stop:         ## 停止本地前后端
	bash ./sb.sh local stop

local-status:       ## 本地运行状态
	bash ./sb.sh local status

pre:                ## 发布到远程预发布环境（配置 deploy/envs/remote-pre.env）
	bash ./sb.sh remote-pre deploy

release:            ## 发布到远程正式环境（配置 deploy/envs/remote-release.env）
	bash ./sb.sh remote-release deploy

deploy:             ## 同 release（发布到正式环境）
	bash ./sb.sh remote-release deploy

deploy-status:      ## 正式环境运行状态
	bash ./sb.sh remote-release status

up:                 ## docker compose 启动(mysql+server+web，默认 db 锁)
	docker compose -f deploy/docker-compose.yml up -d --build

up-redis:           ## docker compose 启动(含 redis，配合 LOCK_DRIVER=redis)
	docker compose -f deploy/docker-compose.yml --profile redis up -d --build

down:               ## 停止全部容器
	docker compose -f deploy/docker-compose.yml down

logs:               ## 跟随后端容器日志
	docker compose -f deploy/docker-compose.yml logs -f server
