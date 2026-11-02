// KC-0024: on the phone a room shows its core; the rest is one tap away. fold() renders a
// button only the phone shows and content the phone folds (app.css .foldbar, app.js data-fold).
// On the laptop the button is hidden and the content is simply there.
import { html, type Markup } from './html.ts';

/** `noegle` tells folds with the same name apart (several cards each fold their own "grundlag"). */
export function fold(navn: string, indhold: Markup, noegle?: string): Markup {
  return html`<button type="button" class="btn btn-ghost kun-telefon fold-knap" data-fold aria-expanded="false">Vis ${navn}</button><div ${noegle ? html`data-fold-id="${noegle}" ` : ''}class="foldbar" data-fold-navn="${navn}">${indhold}</div><!--/fold-->`;
}
