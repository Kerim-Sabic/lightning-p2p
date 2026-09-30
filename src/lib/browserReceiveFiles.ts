/** Returns an identity for one collection entry, even when content is shared. */
export function browserReceiveFileKey(hash: string, index: number): string {
  return `${index}:${hash}`;
}
