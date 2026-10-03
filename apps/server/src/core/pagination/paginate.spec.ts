import { parseSort } from './paginate';

describe('parseSort', () => {
  it('空排序返回默认', () => {
    expect(parseSort(undefined)).toEqual({ id: 'desc' });
    expect(parseSort('')).toEqual({ id: 'desc' });
  });

  it('解析单字段', () => {
    expect(parseSort('createdAt:desc')).toEqual({ createdAt: 'desc' });
  });

  it('解析多字段(逗号分隔)', () => {
    expect(parseSort('status:asc,id:desc')).toEqual({ status: 'asc', id: 'desc' });
  });

  it('非法片段被忽略', () => {
    expect(parseSort('foo:random,createdAt:asc')).toEqual({ createdAt: 'asc' });
    expect(parseSort('nonsense')).toEqual({ id: 'desc' });
  });
});
