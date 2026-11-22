import { ElMessageBox } from "element-plus";

/**
 * 二次确认（有副作用、不可撤销或影响他人的操作前调用）：确认返回 true，取消 / 关闭返回 false。
 *
 *   if (!(await confirmAction(`确定立即执行任务「${row.name}」？`))) return;
 *
 * 只是删除一行数据、按钮就在行内时，用 <el-popconfirm> 更轻；需要展示较长说明时用这里。
 */
export function confirmAction(
  message: string,
  opts: { title?: string; confirmText?: string; type?: "warning" | "info" } = {},
): Promise<boolean> {
  return ElMessageBox.confirm(message, opts.title ?? "请确认", {
    type: opts.type ?? "warning",
    confirmButtonText: opts.confirmText ?? "确定",
    cancelButtonText: "取消",
  })
    .then(() => true)
    .catch(() => false);
}
