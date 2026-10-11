macOS
lsof -i tcp:3000                # 查看占用 3000 端口的进程（TCP）
lsof -i :3000                   # 不区分协议

Linux
ss -tlnp                        # 所有 TCP 监听端口 + 进程
ss -tlnp | grep 3000            # 查指定端口

通用（找到 PID 后）
bash
ps -p <PID> -o pid,command,cwd  # 看是什么程序、工作目录
lsof -p <PID> -d cwd            # macOS 上看进程工作目录（判断属于哪个项目）
kill <PID>                      # 结束进程（必要时 kill -9）

# 一行命令：查端口 → 直接杀（确认是自己的进程再用）
kill $(lsof -ti tcp:3000)       # macOS
kill $(ss -tlnp | grep :3000 | grep -oP 'pid=\K[0-9]+')  # Linux

# 只看监听状态（排除已建立的连接）
lsof -ti tcp:3000 -sTCP:LISTEN  # macOS
你项目里的 ./sb.sh local status 已经内置了这个检测（端口占用时会显示占用进程的 PID 和工作目录，方便判断是不是自己项目的），日常用它就行。