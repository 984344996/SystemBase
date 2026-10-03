/** 日志级别 -> el-tag type */
export function levelTagType(level?: string): "info" | "success" | "warning" | "danger" | "primary" {
  switch (level) {
    case "ERROR":
    case "FATAL":
      return "danger";
    case "WARN":
      return "warning";
    case "INFO":
      return "success";
    default:
      return "info";
  }
}

export const LOG_LEVEL_OPTIONS = ["INFO", "WARN", "ERROR", "DEBUG", "FATAL"];

export const LOG_CATEGORY_OPTIONS = [
  { value: "app", label: "应用" },
  { value: "access", label: "访问" },
  { value: "audit", label: "审计" },
  { value: "job", label: "任务" },
];

/** 日志行 -> 展开区展示用的 JSON（去掉表格已展示的固定字段） */
export function entryDetail(entry: Record<string, unknown>, omit: string[] = ["level", "time", "category", "msg"]): string {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) if (!omit.includes(k)) rest[k] = v;
  return JSON.stringify(rest, null, 2);
}

/** 浏览器端保存 Blob 为文件 */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
