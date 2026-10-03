import { JOB_HANDLERS, JobHandler } from './job-registry';

describe('@JobHandler 装饰器', () => {
  it('类定义时自动注册到注册表', () => {
    const key = 'spec.testHandler';
    @JobHandler(key) class TestJob implements JobHandler {
      async run() {
        return 'done';
      }
    }
    expect(JOB_HANDLERS.get(key)).toBe(TestJob);
    // 清理，避免污染其他用例
    JOB_HANDLERS.delete(key);
  });

  it('重复注册同 key 抛错', () => {
    const key = 'spec.dup';
    @JobHandler(key) class A implements JobHandler {
      async run() {}
    }
    expect(() => {
      @JobHandler(key) class B implements JobHandler {
        async run() {}
      }
    }).toThrow(/重复注册/);
    JOB_HANDLERS.delete(key);
  });
});
