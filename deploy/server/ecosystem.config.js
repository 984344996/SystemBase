/**
 * PM2 进程配置（由 remote-deploy.sh / ops.sh 调用 pm2 startOrReload）
 *
 * cwd 使用 current 软链路径（不解析成真实路径）：切换版本后 reload，
 * 新进程启动时进入的就是新版本目录，无需 pm2 delete 重建。
 */
const appDir = process.env.SB_APP_DIR || '/opt/systembase';
const appName = process.env.SB_APP_NAME || 'systembase';

module.exports = {
  apps: [
    {
      name: `${appName}-server`,
      cwd: `${appDir}/current/apps/server`,
      script: 'dist/main.js',
      // 单实例 fork：内置定时任务与权限缓存都在进程内，多实例需配合 LOCK_DRIVER=redis
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        TZ: process.env.SB_TZ || 'Asia/Shanghai', // 日志按本地零点切分、time 字段为本地时间
      },
      max_memory_restart: '600M',
      kill_timeout: 10000, // 给优雅退出（刷日志、断开数据库）留时间
      // 业务日志由应用写入 shared/logs/app.YYYY-MM-DD.log；这里只接启动失败/崩溃等 stdout/stderr
      out_file: `${appDir}/shared/pm2/out.log`,
      error_file: `${appDir}/shared/pm2/error.log`,
      merge_logs: true,
      time: true,
    },
  ],
};
