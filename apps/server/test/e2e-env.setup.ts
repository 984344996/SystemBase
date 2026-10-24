import { setupE2eEnv } from './e2e-env';

// 先于任何 import AppModule 的代码执行（setupFiles 在模块加载前运行）
setupE2eEnv();
