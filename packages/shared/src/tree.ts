/** 树形行：任意含 id 与 parentId 的扁平结构（菜单/字典等 Prisma 行的通用形状） */
export interface TreeRow {
  id: number;
  parentId: number | null;
}

/** 树节点：扁平行 + children */
export type TreeNode<T extends TreeRow> = T & { children: TreeNode<T>[] };

/**
 * 扁平行 → 树（O(n)）：
 *  - parentId 为 null/0 或父节点不在列表中（如父节点被过滤）时，该节点上浮为根节点；
 *  - prune 可选：对每个节点判断是否保留（先修剪 children 再判断，适合「剔除无可见子节点的空目录」这类需求）。
 *
 * 用法：
 *   buildTree(menus)                                        // 普通建树
 *   buildTree(visible, (n) => n.type === 'MENU' || n.children.length > 0)  // 剔除空目录
 */
export function buildTree<T extends TreeRow>(
  rows: T[],
  prune?: (node: TreeNode<T>) => boolean,
): TreeNode<T>[] {
  const map = new Map<number, TreeNode<T>>();
  rows.forEach((row) => map.set(row.id, { ...row, children: [] }));
  const roots: TreeNode<T>[] = [];
  map.forEach((node) => {
    const parent = node.parentId ? map.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return prune ? filterTree(roots, prune) : roots;
}

function filterTree<T extends TreeRow>(
  nodes: TreeNode<T>[],
  keep: (node: TreeNode<T>) => boolean,
): TreeNode<T>[] {
  const kept: TreeNode<T>[] = [];
  for (const node of nodes) {
    node.children = filterTree(node.children, keep);
    if (keep(node)) kept.push(node);
  }
  return kept;
}
