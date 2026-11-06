/**
 * PM2 进程配置（由 remote-deploy.sh / ops.sh 调用 pm2 startOrReload）
 *
 * cwd 使用 current 软链路径（不解析成真实路径）：切换版本后 reload，
 * 新进程启动时进入的就是新版本目录，无需 pm2 delete 重建。
 * 注意：fork 单实例模式下 reload = 先停旧进程再起新进程，每次发布/回滚后端有数秒不可用。
 */
// 部署目录与应用名由调用脚本通过环境变量传入（同机多环境靠它们区分进程名与路径）
const appDir = process.env.SB_APP_DIR || '/opt/systembase';
const appName = process.env.SB_APP_NAME || 'systembase';

module.exports = {
  apps: [
    {
      name: `${appName}-server`, // PM2 进程名：<APP_NAME>-server
      cwd: `${appDir}/current/apps/server`, // 工作目录：线上版本的后端目录（.env、logs 都是软链）
      script: 'dist/main.js', // 入口：nest build 产物
      // 单实例 fork：内置定时任务与权限缓存都在进程内，多实例需配合 LOCK_DRIVER=redis
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        TZ: process.env.SB_TZ || 'Asia/Shanghai', // 日志按本地零点切分、time 字段为本地时间
      },
      max_memory_restart: '600M', // 内存超过 600M 自动重启（防内存泄漏拖垮机器）
      kill_timeout: 10000, // 给优雅退出（刷日志、断开数据库）留时间
      // 业务日志由应用写入 shared/logs/app.YYYY-MM-DD.log；这里只接启动失败/崩溃等 stdout/stderr
      out_file: `${appDir}/shared/pm2/out.log`,
      error_file: `${appDir}/shared/pm2/error.log`,
      merge_logs: true, // 多次重启的输出写同一个文件
      time: true, // 每行输出加时间戳
    },
  ],
};
