import request from "@/utils/request";

export interface DictRow {
  id: number;
  code: string;
  name: string;
  status: string;
  remark?: string | null;
  _count?: { items: number };
}

export interface DictItemRow {
  id: number;
  dictId: number;
  label: string;
  value: string;
  sort: number;
  status: string;
  remark?: string | null;
}

export interface DictOption {
  label: string;
  value: string;
}

export const dictApi = {
  list: (params: { keyword?: string }) => request.get<never, DictRow[]>("/dicts", { params }),
  create: (data: Partial<DictRow>) => request.post<never, DictRow>("/dicts", data),
  update: (id: number, data: Partial<DictRow>) => request.put<never, DictRow>(`/dicts/${id}`, data),
  remove: (id: number) => request.delete<never, { success: boolean }>(`/dicts/${id}`),
  items: (dictId: number) => request.get<never, DictItemRow[]>(`/dicts/${dictId}/items`),
  addItem: (dictId: number, data: Partial<DictItemRow>) =>
    request.post<never, DictItemRow>(`/dicts/${dictId}/items`, data),
  updateItem: (itemId: number, data: Partial<DictItemRow>) =>
    request.put<never, DictItemRow>(`/dicts/items/${itemId}`, data),
  removeItem: (itemId: number) => request.delete<never, { success: boolean }>(`/dicts/items/${itemId}`),
  /** 业务/前端下拉用：按字典编码取启用中的选项 */
  options: (code: string) => request.get<never, DictOption[]>(`/dicts/options/${code}`),
};
