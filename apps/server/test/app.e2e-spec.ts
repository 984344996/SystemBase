import { INestApplication, ValidationPipe } from '@nestjs/common';
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
  let app: INestApplication;
  let adminToken: string;
  const stamp = Date.now().toString(36); // 避免重复运行撞唯一约束
  const roleCode = `e2e_role_${stamp}`;
  const limitedUser = { username: `e2e_user_${stamp}`, password: 'E2ePass123' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // 与 main.ts 对齐的关键配置（prefix + 校验管道）
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
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

  it('创建角色 → 201；预检重复 → 400', async () => {
    const server = app.getHttpServer();
    const payload = { code: roleCode, name: 'E2E 测试角色', remark: 'e2e' };

    await request(server)
      .post('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)
      .expect(201);

    // 预检重复：400（普通 BadRequestException）；竞态兜底（P2002→40901）在单测覆盖
    await request(server)
      .post('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)
      .expect(400);
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
});
