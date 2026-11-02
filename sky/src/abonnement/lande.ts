// The countries an account can buy from (D13: EU only, so the EU and EEA), asked on the plan page
// and kept on the billing customer. Never guessed from an IP address (KC-0191). Denmark first.

export type Land = { kode: string; navn: string };

export const LANDE: readonly Land[] = [
  { kode: 'DK', navn: 'Danmark' },
  { kode: 'BE', navn: 'Belgien' },
  { kode: 'BG', navn: 'Bulgarien' },
  { kode: 'CY', navn: 'Cypern' },
  { kode: 'EE', navn: 'Estland' },
  { kode: 'FI', navn: 'Finland' },
  { kode: 'FR', navn: 'Frankrig' },
  { kode: 'GR', navn: 'Grækenland' },
  { kode: 'NL', navn: 'Holland' },
  { kode: 'IE', navn: 'Irland' },
  { kode: 'IS', navn: 'Island' },
  { kode: 'IT', navn: 'Italien' },
  { kode: 'HR', navn: 'Kroatien' },
  { kode: 'LV', navn: 'Letland' },
  { kode: 'LI', navn: 'Liechtenstein' },
  { kode: 'LT', navn: 'Litauen' },
  { kode: 'LU', navn: 'Luxembourg' },
  { kode: 'MT', navn: 'Malta' },
  { kode: 'NO', navn: 'Norge' },
  { kode: 'PL', navn: 'Polen' },
  { kode: 'PT', navn: 'Portugal' },
  { kode: 'RO', navn: 'Rumænien' },
  { kode: 'SK', navn: 'Slovakiet' },
  { kode: 'SI', navn: 'Slovenien' },
  { kode: 'ES', navn: 'Spanien' },
  { kode: 'SE', navn: 'Sverige' },
  { kode: 'CZ', navn: 'Tjekkiet' },
  { kode: 'DE', navn: 'Tyskland' },
  { kode: 'HU', navn: 'Ungarn' },
  { kode: 'AT', navn: 'Østrig' },
];

export const erLand = (v: unknown): v is string => typeof v === 'string' && LANDE.some((l) => l.kode === v);
