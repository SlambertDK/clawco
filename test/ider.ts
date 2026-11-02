// KC-0064 phase 3 test helpers: the data-id values of a rendered room.
const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** Every data-id value in document order, entities decoded. */
export function ider(out: string): string[] {
  return [...out.matchAll(/\sdata-id="([^"]*)"/g)].map((m) => m[1]!.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENT[e]!));
}

/** The ids that occur more than once (each listed once). */
export function dubletter(out: string): string[] {
  const set = new Set<string>();
  const dup = new Set<string>();
  for (const id of ider(out)) (set.has(id) ? dup : set).add(id);
  return [...dup];
}
