import request from "@/utils/request";
import { formatSize } from "@/utils/datetime";
import type { PageResult } from "@sb/shared";

export { formatSize };

export interface FileRow {
  id: number;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  uploaderId?: number | null;
}

export const fileApi = {
  list: (params: { page?: number; pageSize?: number; keyword?: string }) =>
    request.get<never, PageResult<FileRow>>("/files", { params }),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request.post<never, FileRow>("/files/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  /**
   * 下载：走 axios（Authorization 头鉴权，过期自动静默刷新），返回 Blob 由调用方保存。
   * 不用 `<a href="...?token=">`：token 会写进 Nginx/代理访问日志，且后端只认请求头。
   */
  download: (id: number) =>
    request.get<never, Blob>(`/files/${id}/download`, { responseType: "blob", timeout: 300_000 }),
  remove: (id: number) => request.delete<never, { success: boolean }>(`/files/${id}`),
};
