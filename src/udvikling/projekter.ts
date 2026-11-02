// KC-0041: the projects Henrik can send a task to. The source of truth for the
// list: a project is added here when it gets the method (/metode:init) and so a
// ticket queue the metode plugin can write into.

export type Projekt = { id: string; navn: string; repo: string };

export const PROJEKTER: readonly Projekt[] = [
  { id: 'kontrolcenter', navn: 'Kontrolcenter', repo: 'SlambertDK/kontrolcenter' },
  { id: 'shelfatlas', navn: 'ShelfAtlas', repo: 'SlambertDK/ShelfAtlas' },
];

export const findProjekt = (id: string): Projekt | undefined => PROJEKTER.find((p) => p.id === id);

/** GitHub repo names are case-insensitive, so `owner/name` matches in any case. */
export const projektForRepo = (repo: string): Projekt | undefined =>
  PROJEKTER.find((p) => p.repo.toLowerCase() === repo.trim().toLowerCase());
