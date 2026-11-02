// KC-0117: an element's data zone on screen. Every element root carries
// `data-datazone`; the chip is in the markup always, and CSS shows it only when
// the room has more than one zone in play (public/app.css, `.zone-chip`), so a
// single-user install keeps today's clean look and a live fragment swap needs
// no server state.

import { html, type Markup } from './html.ts';
import { ZONE_NAVN, zoneAf, type Zoneret } from '../identitet/zoner.ts';

/** ` data-datazone="<zone>"` for the element's root tag. */
export const zoneData = (el: Zoneret): Markup => html` data-datazone="${zoneAf(el)}"`;

/** The small zone chip, placed inside the element (hidden unless the room mixes zones). */
export const zoneChip = (el: Zoneret): Markup => html`<span class="chip zone-chip">${ZONE_NAVN[zoneAf(el)]}</span>`;
