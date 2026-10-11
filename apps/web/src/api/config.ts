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
  update: (key: string, data: ConfigPayload) => request.put<never, ConfigRow>(`/configs/${key}`, data),
  remove: (key: string) => request.delete<never, { success: boolean }>(`/configs/${key}`),
};
