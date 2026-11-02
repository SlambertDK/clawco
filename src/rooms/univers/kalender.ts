// Meetings from Google Calendar (scripts/kalender_uge.py): timed events with at
// least one participant besides Henrik. Henrik himself is left out of deltagere.

export type KalenderMoede = {
  eventId: string; titel: string; start: string; slut: string; sted?: string;
  deltagere: { navn: string; email?: string }[];
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const s = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** "anne-marie.berg@x" → "Anne-Marie Berg": a name is never an address (KC-0023). */
function navnFraAdresse(email: string): string {
  const lokal = email.split('@')[0] ?? '';
  return lokal.split(/[._]+/).filter(Boolean)
    .map((ord) => ord.split('-').map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join('-'))
    .join(' ');
}

export function moederFraKalender(raw: unknown): KalenderMoede[] {
  const ud: KalenderMoede[] = [];
  const set = new Set<string>();
  const dage = isObj(raw) && Array.isArray(raw['days']) ? raw['days'] : [];
  for (const d of dage) {
    for (const e of isObj(d) && Array.isArray(d['events']) ? d['events'] : []) {
      if (!isObj(e) || e['all_day'] === true) continue;
      const eventId = s(e['id'], 200); const titel = s(e['title'], 120);
      const start = s(e['start'], 40); const slut = s(e['end'], 40);
      if (!eventId || !titel || !start || !slut || set.has(eventId)) continue;
      const deltagere: KalenderMoede['deltagere'] = [];
      for (const p of Array.isArray(e['attendees']) ? e['attendees'] : []) {
        if (!isObj(p) || p['self'] === true) continue;
        const email = s(p['email'], 120);
        const navn = s(p['name'], 80) || (email ? navnFraAdresse(email) : '');
        if (!navn) continue;
        deltagere.push(email ? { navn, email } : { navn });
      }
      if (deltagere.length === 0) continue;
      set.add(eventId);
      const m: KalenderMoede = { eventId, titel, start, slut, deltagere };
      const sted = s(e['location'], 120); if (sted) m.sted = sted;
      ud.push(m);
    }
  }
  return ud;
}
