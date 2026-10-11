import request from "@/utils/request";
import type { PageResult } from "@sb/shared";

export interface NoticeRow {
  id: number;
  title: string;
  content: string;
  type: string;
  top: boolean;
  status: string;
  startAt?: string | null;
  endAt?: string | null;
  createdAt?: string;
  /** 用户侧接口返回：是否已读 */
  read?: boolean;
}

export const noticeApi = {
  /** 我可见的公告（含已读标记） */
  mine: () => request.get<never, NoticeRow[]>("/notices/mine"),
  unreadCount: () => request.get<never, number>("/notices/unread-count"),
  read: (id: number) => request.post<never, { success: boolean }>(`/notices/${id}/read`),
  list: (params: Record<string, unknown>) => request.get<never, PageResult<NoticeRow>>("/notices", { params }),
  create: (data: Partial<NoticeRow>) => request.post<never, NoticeRow>("/notices", data),
  update: (id: number, data: Partial<NoticeRow>) => request.put<never, NoticeRow>(`/notices/${id}`, data),
  publish: (id: number) => request.post<never, NoticeRow>(`/notices/${id}/publish`),
  remove: (id: number) => request.delete<never, { success: boolean }>(`/notices/${id}`),
};
