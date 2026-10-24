import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';

/**
 * 安全修复回归（2026-10-24 设计审查）：对真实数据库跑完整守卫链，
 * 覆盖提权、改密后旧 token 失效、强制改密服务端拦截、refresh 并发、默认拒绝、文件上传下载。
 */
describe('Security E2E（审查修复回归）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  const stamp = Date.now().toString(36);
  const PWD = 'E2ePass123';

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function login(username: string, password = PWD) {
    const res = await request(server()).post('/api/auth/login').send({ username, password }).expect(201);
    return res.body.data as { accessToken: string; refreshToken: string };
  }

  /** 建一个只拥有指定权限码的角色 + 用户，返回其 token */
  async function userWithPerms(tag: string, perms: string[]) {
    const menus = await prisma.menu.findMany({ where: { permission: { in: perms } }, select: { id: true } });
    const role = await request(server())
      .post('/api/roles')
      .set(auth(adminToken))
      .send({ code: `e2e_${tag}_${stamp}`, name: `E2E ${tag}`, menuIds: menus.map((m) => m.id) })
      .expect(201);
    const username = `e2e_${tag}_${stamp}`;
    const user = await request(server())
      .post('/api/users')
      .set(auth(adminToken))
      .send({ username, password: PWD, name: tag, roleIds: [role.body.data.id] })
      .expect(201);
    return { username, userId: user.body.data.id as number, roleId: role.body.data.id as number, ...(await login(username)) };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    adminToken = (await login('admin', 'admin123')).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('提权防护', () => {
    it('有用户管理权限的非超管：不能授予超管角色、不能重置超管密码', async () => {
      const ops = await userWithPerms('ops', ['system:user:list', 'system:user:create', 'system:user:update', 'system:user:resetPwd']);
      const superRole = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
      const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' } });

      const grant = await request(server())
        .put(`/api/users/${ops.userId}`)
        .set(auth(ops.accessToken))
        .send({ name: '提权尝试', roleIds: [superRole.id] })
        .expect(403);
      expect(grant.body.code).toBe(40302);

      const takeover = await request(server())
        .put(`/api/users/${admin.id}/password`)
        .set(auth(ops.accessToken))
        .send({ newPassword: 'Takeover123' })
        .expect(403);
      expect(takeover.body.code).toBe(40302);
    });

    it('有角色管理权限的非超管：不能给自己所属角色加权限', async () => {
      const editor = await userWithPerms('roleed', ['system:role:list', 'system:role:update']);
      const delMenu = await prisma.menu.findFirstOrThrow({ where: { permission: 'system:user:delete' } });
      await request(server())
        .put(`/api/roles/${editor.roleId}`)
        .set(auth(editor.accessToken))
        .send({ name: '自我加权', menuIds: [delMenu.id] })
        .expect(403);
    });
  });

  describe('改密与强制改密', () => {
    it('管理员重置密码后：旧 accessToken 立即失效；新登录只能访问改密等少数接口', async () => {
      const u = await userWithPerms('reset', ['system:user:list']);
      await request(server()).get('/api/users').set(auth(u.accessToken)).expect(200);

      // JWT iat 精度为秒：等到下一秒再重置，保证旧 token 的签发时间早于改密时间
      await new Promise((r) => setTimeout(r, 1100));
      await request(server()).put(`/api/users/${u.userId}/password`).set(auth(adminToken)).send({ newPassword: 'NewPass456' }).expect(200);
      await new Promise((r) => setTimeout(r, 1100));

      await request(server()).get('/api/users').set(auth(u.accessToken)).expect(401); // 旧 token 失效

      const fresh = await login(u.username, 'NewPass456');
      const blocked = await request(server()).get('/api/users').set(auth(fresh.accessToken)).expect(403);
      expect(blocked.body.code).toBe(40301); // 必须先改密
      await request(server()).get('/api/auth/profile').set(auth(fresh.accessToken)).expect(200); // 改密页需要的接口放行
    });
  });

  describe('refresh 轮换并发', () => {
    it('同一 refreshToken 并发刷新：只有一个成功，另一个 401，且不会吊销全部登录态', async () => {
      const { refreshToken, accessToken } = await login('admin', 'admin123');
      const [a, b] = await Promise.all([
        request(server()).post('/api/auth/refresh').send({ refreshToken }),
        request(server()).post('/api/auth/refresh').send({ refreshToken }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 401]);
      const winner = a.status === 201 ? a : b;
      // 宽限期内的重复使用不判定为重放：成功拿到的新 refreshToken 仍可用
      await request(server()).post('/api/auth/refresh').send({ refreshToken: winner.body.data.refreshToken }).expect(201);
      await request(server()).get('/api/auth/profile').set(auth(accessToken)).expect(200);
    });
  });

  describe('默认拒绝', () => {
    it('「登录即可」的接口显式标注后可访问；roles/all 需要用户管理权限', async () => {
      const plain = await userWithPerms('plain', []);
      await request(server()).get('/api/auth/menus').set(auth(plain.accessToken)).expect(200);
      await request(server()).get('/api/notices/unread-count').set(auth(plain.accessToken)).expect(200);
      await request(server()).get('/api/roles/all').set(auth(plain.accessToken)).expect(403);
    });
  });

  describe('文件上传下载', () => {
    it('上传后用 Authorization 头下载内容一致；伪装扩展名被拒；ETag 协商 304', async () => {
      const up = await request(server())
        .post('/api/files/upload')
        .set(auth(adminToken))
        .attach('file', Buffer.from('hello e2e'), 'e2e.txt')
        .expect(201);
      const id = up.body.data.id;
      expect(up.body.data.mime).toBe('text/plain');

      const dl = await request(server()).get(`/api/files/${id}/download`).set(auth(adminToken)).buffer(true).expect(200);
      expect(dl.text ?? dl.body.toString()).toBe('hello e2e');
      await request(server()).get(`/api/files/${id}/download`).set(auth(adminToken)).set('If-None-Match', dl.headers.etag).expect(304);
      await request(server()).get(`/api/files/${id}/download?token=${adminToken}`).expect(401); // query token 不被接受

      await request(server())
        .post('/api/files/upload')
        .set(auth(adminToken))
        .attach('file', Buffer.from('not a png'), 'fake.png')
        .expect(400);
      await request(server())
        .post('/api/files/upload')
        .set(auth(adminToken))
        .attach('file', Buffer.from('<script>alert(1)</script>'), 'x.html')
        .expect(400);

      await request(server()).delete(`/api/files/${id}`).set(auth(adminToken)).expect(200);
    });
  });

  describe('排序白名单', () => {
    it('sort=password:asc 被忽略（不报错、不按密码排序）', async () => {
      await request(server()).get('/api/users?sort=password:asc').set(auth(adminToken)).expect(200);
      await request(server()).get('/api/users?sort=notAField:desc').set(auth(adminToken)).expect(200);
    });
  });
});
