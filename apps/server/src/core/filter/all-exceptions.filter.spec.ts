import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { BizCode, BusinessException, duplicate } from './business.exception';

/** 构造最小的 ArgumentsHost，捕获写出的状态码与响应体 */
function run(exception: unknown) {
  const logger = { errorFields: jest.fn(), warnFields: jest.fn() };
  const filter = new AllExceptionsFilter(logger as any);
  const out: { status?: number; body?: any } = {};
  const res = {
    status: (s: number) => ((out.status = s), res),
    json: (b: unknown) => ((out.body = b), res),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url: '/api/x' }) }),
  } as any;
  filter.catch(exception, host);
  return { ...out, logger };
}

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: '5', meta });

describe('AllExceptionsFilter', () => {
  it('业务异常：code 为业务码，data 透传', () => {
    const r = run(new BusinessException(BizCode.NEED_CAPTCHA, '请输入验证码', HttpStatus.PRECONDITION_FAILED, { needCaptcha: true }));
    expect(r.status).toBe(412);
    expect(r.body).toMatchObject({ code: 42801, message: '请输入验证码', data: { needCaptcha: true } });
  });

  it('duplicate()：409 + 40901', () => {
    const r = run(duplicate('编码已存在'));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: BizCode.DUPLICATE, message: '编码已存在' });
  });

  it('Nest HTTP 异常：code 等于 HTTP 状态；校验错误数组合并成一句', () => {
    expect(run(new NotFoundException('角色不存在')).body).toMatchObject({ code: 404, message: '角色不存在' });
    const r = run(new BadRequestException(['name 不能为空', 'code 过长']));
    expect(r.body).toMatchObject({ code: 400, message: 'name 不能为空；code 过长' });
  });

  it.each([
    ['P2002', { target: ['code'] }, 409, BizCode.DUPLICATE, /已存在/],
    ['P2025', undefined, 404, BizCode.NOT_FOUND, /不存在/],
    ['P2003', { field_name: 'roleId' }, 409, BizCode.INVALID_STATE, /引用/],
    ['P2000', { column_name: 'name' }, 400, BizCode.INVALID_DATA, /过长/],
  ])('Prisma %s → HTTP %i / 业务码 %i', (code, meta, status, bizCode, msg) => {
    const r = run(prismaError(code as string, meta as Record<string, unknown> | undefined));
    expect(r.status).toBe(status);
    expect(r.body.code).toBe(bizCode);
    expect(r.body.message).toMatch(msg as RegExp);
    expect(r.logger.warnFields).toHaveBeenCalled(); // 4xx 记 warn 而不是 error
  });

  it('未映射的 Prisma 错误与未知错误 → 500，记 error 日志', () => {
    const r = run(prismaError('P1001'));
    expect(r.status).toBe(500);
    expect(r.logger.errorFields).toHaveBeenCalled();
    expect(run(new Error('boom')).status).toBe(500);
  });

  it('生产环境不暴露内部错误信息', () => {
    const old = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(run(new Error('SELECT * FROM secret')).body.message).toBe('服务器内部错误');
    } finally {
      process.env.NODE_ENV = old;
    }
  });
});
