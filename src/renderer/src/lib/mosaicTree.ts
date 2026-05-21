import type { MosaicNode, MosaicDirection } from 'react-mosaic-component'

/** Collect all leaf ids in the tree. */
export function getLeaves(node: MosaicNode<string> | null): string[] {
  if (node === null) return []
  if (typeof node === 'string') return [node]
  return [...getLeaves(node.first), ...getLeaves(node.second)]
}

/** Replace a single leaf with a split node containing the leaf plus a new pane. */
export function splitLeaf(
  node: MosaicNode<string> | null,
  targetId: string,
  newId: string,
  direction: MosaicDirection
): MosaicNode<string> {
  const split: MosaicNode<string> = {
    direction,
    first: targetId,
    second: newId,
    splitPercentage: 50
  }
  if (node === null) return newId
  if (typeof node === 'string') return node === targetId ? split : node
  return {
    ...node,
    first: splitLeaf(node.first, targetId, newId, direction),
    second: splitLeaf(node.second, targetId, newId, direction)
  }
}

/** Remove a leaf and promote its sibling so the tree stays well-formed. */
export function removeLeaf(
  node: MosaicNode<string> | null,
  targetId: string
): MosaicNode<string> | null {
  if (node === null) return null
  if (typeof node === 'string') return node === targetId ? null : node
  const first = removeLeaf(node.first, targetId)
  const second = removeLeaf(node.second, targetId)
  if (first === null) return second
  if (second === null) return first
  return { ...node, first, second }
}
