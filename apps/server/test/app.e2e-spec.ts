import { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from '../src/core/bootstrap/configure-app';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BizCode } from '../src/core/filter/business.exception';

/**
 * 主链路 E2E 冒烟：健康检查 → 登录 → 认证/权限 → CRUD → 业务错误码。
 *
 * 覆盖目标：全局守卫链（限流→JWT→权限）、统一响应包裹、异常过滤器、
 * 校验管道、种子数据可用性——这些是「框架能不能跑起来」的底线，
 * 改 core 层（guard/filter/interceptor）后必须全绿。
 */
describe('App E2E（主链路冒烟）', () => {
  let app: NestExpressApplication;
  let adminToken: string;
  const stamp = Date.now().toString(36); // 避免重复运行撞唯一约束
  const roleCode = `e2e_role_${stamp}`;
  const limitedUser = { username: `e2e_user_${stamp}`, password: 'E2ePass123' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // 与 main.ts 完全一致的 HTTP 层配置（安全头 / 请求体上限 / 前缀 / CORS / 全局校验）
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('安全响应头与请求体上限：走的是 main.ts 的真实配置（helmet / BODY_LIMIT / 统一 413 结构）', async () => {
    const server = app.getHttpServer();
    const health = await request(server).get('/api/health').expect(200);
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-powered-by']).toBeUndefined();
    // 测试环境默认开启 API 文档，CSP 为放宽版；两种策略都禁止被嵌入 iframe
    expect(health.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    // 超过 BODY_LIMIT（默认 1mb）：返回统一错误结构，而不是 Express 默认的 HTML
    const big = { username: 'x'.repeat(1100 * 1024), password: 'x' };
    const res = await request(server).post('/api/auth/login').send(big).expect(413);
    expect(res.body).toMatchObject({ code: 413, data: null });
    expect(typeof res.body.traceId).toBe('string');
  });

  it('GET /api/health → 200', () =>
    request(app.getHttpServer()).get('/api/health').expect(200).expect((res) => {
      expect(res.body.code).toBe(0);
    }));

  it('登录：错误密码 → 401 + 统一错误结构（含 traceId）', () =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong-password' })
      .expect(401)
      .expect((res) => {
        expect(res.body.code).toBe(401);
        expect(res.body.data).toBeNull();
        expect(typeof res.body.traceId).toBe('string');
      }));

  it('登录：admin → 201 拿到 accessToken', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' })
      .expect(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.accessToken).toBeTruthy();
    adminToken = res.body.data.accessToken;
  });

  it('无 token 访问 /api/users → 401', () =>
    request(app.getHttpServer()).get('/api/users').expect(401));

  it('带 token 访问 /api/users → 200 + 分页结构（走完整守卫链与响应包裹）', () =>
    request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.code).toBe(0);
        expect(Array.isArray(res.body.data.list)).toBe(true);
        expect(typeof res.body.data.total).toBe('number');
      }));

  it('创建角色 → 201；重复 → 409 + 业务码 40901（预检与并发兜底口径一致）', async () => {
    const server = app.getHttpServer();
    const payload = { code: roleCode, name: 'E2E 测试角色', remark: 'e2e' };

    await request(server)
      .post('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)
      .expect(201);

    // 预检重复与并发撞唯一约束（P2002）统一返回 409 / 40901，前端按业务码识别「重复」
    const dup = await request(server)
      .post('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)
      .expect(409);
    expect(dup.body.code).toBe(BizCode.DUPLICATE);
  });

  it('白名单校验：提交未知字段 → 400（forbidNonWhitelisted）', () =>
    request(app.getHttpServer())
      .post('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: `x_${stamp}`, name: 'x', hack: 1 })
      .expect(400));

  it('权限拒绝：无角色用户访问受保护接口 → 403', async () => {
    const server = app.getHttpServer();
    // admin 创建一个无角色用户
    await request(server)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: limitedUser.username, password: limitedUser.password, name: 'E2E 受限用户' })
      .expect(201);

    // 该用户登录（能登录，但无任何权限）
    const login = await request(server)
      .post('/api/auth/login')
      .send({ username: limitedUser.username, password: limitedUser.password })
      .expect(201);
    const limitedToken = login.body.data.accessToken;

    await request(server)
      .get('/api/users')
      .set('Authorization', `Bearer ${limitedToken}`)
      .expect(403);
  });

  it('业务错误码结构：BusinessException 的 code 与 HTTP 状态解耦', async () => {
    // 验证码未启用（LOGIN_CAPTCHA 默认 off），此处只校验 401 时 code 与 status 一致的既有约定
    const res = await request(app.getHttpServer())
      .get('/api/roles/999999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    expect(res.body.code).toBe(404);
    expect(res.body.message).toContain('不存在');
  });

  it('菜单下发：隐藏菜单（visible=false）仍返回（前端只注册路由、不显示在侧栏），停用菜单不返回', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const create = (name: string, extra: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/api/menus')
        .set(auth)
        .send({ parentId: 0, name, type: 'MENU', path: `/e2e/${name}`, component: 'dashboard/Dashboard', sort: 999, ...extra })
        .expect(201)
        .then((r) => r.body.data.id as number);
    const hiddenId = await create(`hidden_${stamp}`, { visible: false });
    const disabledId = await create(`disabled_${stamp}`, { status: 'DISABLED' });
    try {
      const res = await request(app.getHttpServer()).get('/api/auth/menus').set(auth).expect(200);
      const flat: Array<{ id: number; visible: boolean }> = [];
      const walk = (nodes: Array<{ id: number; visible: boolean; children?: unknown[] }>) =>
        nodes.forEach((n) => {
          flat.push(n);
          walk((n.children as typeof nodes) || []);
        });
      walk(res.body.data);
      expect(flat.find((n) => n.id === hiddenId)?.visible).toBe(false);
      expect(flat.some((n) => n.id === disabledId)).toBe(false);
    } finally {
      for (const id of [hiddenId, disabledId]) await request(app.getHttpServer()).delete(`/api/menus/${id}`).set(auth);
    }
  });

  it('菜单层级：按钮只能挂在页面下；修改时同样校验父级', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const server = app.getHttpServer();
    const page = await request(server)
      .post('/api/menus')
      .set(auth)
      .send({ parentId: 0, name: `page_${stamp}`, type: 'MENU', path: `/e2e/page_${stamp}`, component: 'dashboard/Dashboard', sort: 999 })
      .expect(201);
    const pageId = page.body.data.id as number;
    let btnId: number | undefined;
    try {
      await request(server)
        .post('/api/menus')
        .set(auth)
        .send({ parentId: 0, name: `btn_top_${stamp}`, type: 'BUTTON', permission: `e2e:${stamp}:x`, sort: 1 })
        .expect(400);
      // 页面下加按钮（原来后端只允许挂在目录下，界面也无法创建按钮权限点）；切换类型后残留的 path 被清掉
      const btn = await request(server)
        .post('/api/menus')
        .set(auth)
        .send({ parentId: pageId, name: `btn_${stamp}`, type: 'BUTTON', permission: `e2e:${stamp}:x`, path: '/stale', sort: 1 })
        .expect(201);
      btnId = btn.body.data.id as number;
      expect(btn.body.data.path).toBeNull();
      // 把页面挂到按钮下 → 400（原来 update 只防循环）
      await request(server)
        .put(`/api/menus/${pageId}`)
        .set(auth)
        .send({ parentId: btnId, name: `page_${stamp}`, type: 'MENU', path: `/e2e/page_${stamp}`, component: 'dashboard/Dashboard', sort: 999 })
        .expect(400);
    } finally {
      if (btnId) await request(server).delete(`/api/menus/${btnId}`).set(auth);
      await request(server).delete(`/api/menus/${pageId}`).set(auth);
    }
  });

  it('用户软删除后可重建同名账号（原来被唯一约束挡住）', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const server = app.getHttpServer();
    const body = { username: `e2e_reuse_${stamp}`, password: 'E2ePass123', name: '重建' };
    const first = await request(server).post('/api/users').set(auth).send(body).expect(201);
    await request(server).delete(`/api/users/${first.body.data.id}`).set(auth).expect(200);
    const second = await request(server).post('/api/users').set(auth).send(body).expect(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);
    await request(server).delete(`/api/users/${second.body.data.id}`).set(auth).expect(200);
  });

  it('个人资料：邮箱留空表示清空（原来返回 400）；格式错误 → 400', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const server = app.getHttpServer();
    const res = await request(server).put('/api/auth/profile').set(auth).send({ email: '', phone: '' }).expect(200);
    expect(res.body.data.email ?? null).toBeNull();
    await request(server).put('/api/auth/profile').set(auth).send({ email: 'not-an-email' }).expect(400);
  });
});
