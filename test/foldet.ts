// KC-0024 test helper: what a render folds away on the phone (shell/fold.ts), by name.
export function foldet(out: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of out.matchAll(/class="foldbar" data-fold-navn="([^"]+)">([\s\S]*?)<\/div><!--\/fold-->/g)) m.set(f[1]!.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'), f[2]!);
  return m;
}
export const iFold = (out: string, tekst: string): boolean => [...foldet(out).values()].some((v) => v.includes(tekst));
