// The spoken view of Skrive (KC-0015): résumé only. Writing is screen work.

import type { StemmeRum } from '../../stemme/types.ts';
import { taleTekst } from '../../stemme/tale.ts';
import type { SkriveState } from './schema.ts';

export function stemmeSkrive(state: SkriveState | null): StemmeRum {
  const dok = state ? (state.dokumenter.find((d) => d.id === state.aktivt) ?? state.dokumenter[0]) : undefined;
  const titel = dok ? taleTekst(dok.titel).replace(/[.!?]+$/, '') : '';
  return { rum: 'skrive', resume: dok ? `Et udkast er i gang: ${titel}.` : 'Intet udkast i gang.', punkter: [] };
}
