// "Den store bil" inside a Danish sentence is "den store bil"; a proper name keeps its capital. Its own file so that
// the language table (tekster.ts) and the rules (ressource.ts) can both use it without importing each other.

export const iSaetning = (navn: string): string => (/^(Den|Det|De) /.test(navn) ? navn[0]!.toLowerCase() + navn.slice(1) : navn);
