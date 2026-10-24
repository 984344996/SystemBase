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
    expect(parseSort('status:asc,id:desc', undefined, ['status', 'id'])).toEqual({ status: 'asc', id: 'desc' });
  });

  it('非法片段被忽略', () => {
    expect(parseSort('foo:random,createdAt:asc')).toEqual({ createdAt: 'asc' });
    expect(parseSort('nonsense')).toEqual({ id: 'desc' });
  });

  it('白名单外的字段被忽略（防按 password 排序 / 未知字段触发 500）', () => {
    expect(parseSort('password:asc')).toEqual({ id: 'desc' });
    expect(parseSort('roles:asc,createdAt:desc')).toEqual({ createdAt: 'desc' });
    expect(parseSort('name:asc', undefined, ['name'])).toEqual({ name: 'asc' });
  });

  it('最多取前 3 个排序字段', () => {
    const sortable = ['a', 'b', 'c', 'd'];
    expect(Object.keys(parseSort('a:asc,b:asc,c:asc,d:asc', undefined, sortable))).toEqual(['a', 'b', 'c']);
  });
});
