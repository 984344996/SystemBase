import request from "@/utils/request";

export type ConfigType = "STRING" | "NUMBER" | "BOOL" | "JSON";

export interface ConfigRow {
  key: string;
  value: string;
  type: ConfigType;
  group: string;
  label: string;
  builtin: boolean;
  remark?: string | null;
  updatedAt?: string;
}

export type ConfigPayload = Partial<ConfigRow>;

export const configApi = {
  list: (params: { group?: string; keyword?: string }) =>
    request.get<never, ConfigRow[]>("/configs", { params }),
  all: () => request.get<never, ConfigRow[]>("/configs/all"),
  create: (data: ConfigPayload) => request.post<never, ConfigRow>("/configs", data),
  // key 要编码：含 / # ? 等字符时直接拼进 URL 会请求到错误的接口
  update: (key: string, data: ConfigPayload) => request.put<never, ConfigRow>(`/configs/${encodeURIComponent(key)}`, data),
  remove: (key: string) => request.delete<never, { success: boolean }>(`/configs/${encodeURIComponent(key)}`),
};

/** 按类型校验参数值（与后端 ConfigService.assertValue 一致）：不合法返回提示文案，合法返回 null */
export function configValueProblem(value: string, type?: string): string | null {
  if (type === "NUMBER" && (value.trim() === "" || !Number.isFinite(Number(value)))) return "数值类型的参数必须填写数字";
  if (type === "BOOL" && !["true", "false", "1", "0", "on", "off", "yes", "no"].includes(value.trim().toLowerCase())) {
    return "布尔类型的参数只能填 true / false（也可写 1 / 0、on / off、yes / no）";
  }
  if (type === "JSON") {
    try {
      JSON.parse(value);
    } catch {
      return "JSON 类型的参数必须是合法的 JSON";
    }
  }
  return null;
}
