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
  /** 下载链接（仍走接口鉴权，带上 token 后可直接用浏览器下载） */
  downloadUrl: (id: number) => `${import.meta.env.BASE_URL}api/files/${id}/download`,
  remove: (id: number) => request.delete<never, { success: boolean }>(`/files/${id}`),
};
