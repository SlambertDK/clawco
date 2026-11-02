// The Post seam (KC-0177): every mail Sky sends goes through send(). The real provider is Resend from
// its EU sending region (KC-0178, post-udbyder.ts, which also holds the factory postFraEnv). Never log
// a message's data: it carries login links.
import { renderMail, SkabelonFejl, type Mail, type Skabelon, type Sprog } from './skabeloner/index.ts';

export type { Skabelon, Sprog, Mail };

/** `data` is checked per template by renderMail (skabeloner/index.ts has the typed shapes). */
export type Besked = { til: string; skabelon: Skabelon; sprog?: Sprog; data: Record<string, string> };

export interface Post {
  /** Resolves when the provider accepted the message; rejects with PostFejl otherwise (callers fail closed). */
  send(b: Besked): Promise<void>;
}

export type PostFejlKode =
  | 'ingen-udbyder' // no provider configured (production without a key)
  | 'ugyldig' // the message could not be rendered (missing or unsafe data)
  | 'afvist' // the provider refused this message
  | 'noegle' // the key is invalid, inactive or not allowed to do what sending needs
  | 'kvote' // rate or quota limit
  | 'udbyder' // the provider failed or answered something unexpected
  | 'netvaerk' // the provider could not be reached
  | 'sporing' // the sending domain has open or click tracking on
  | 'region' // the sending domain is not in the EU region
  | 'domaene'; // the sending domain is missing or not verified

/** The one failure type of the seam. Its message never carries a recipient, a link or provider text. */
export class PostFejl extends Error {
  readonly kode: PostFejlKode;
  constructor(kode: PostFejlKode, besked: string) {
    super(besked);
    this.name = 'PostFejl';
    this.kode = kode;
  }
}

/** Renders a message, turning a template failure into the seam's typed failure. */
export function renderBesked(b: Besked): Mail {
  try {
    return renderMail(b);
  } catch (err) {
    if (err instanceof SkabelonFejl) throw new PostFejl('ugyldig', err.message);
    throw err;
  }
}

export type FalskPost = Post & { udbakke: Besked[]; fejl: boolean };

/** In-memory Post for tests and SKY_DEV=1 (the outbox page reads `udbakke`). It renders every message,
 *  so bad data fails here as it would in production. `fejl` makes send reject. */
export function falskPost(): FalskPost {
  const p: FalskPost = {
    udbakke: [],
    fejl: false,
    async send(b) {
      renderBesked(b);
      if (p.fejl) throw new PostFejl('afvist', 'falsk post: afvist');
      p.udbakke.push(b);
    },
  };
  return p;
}

/** Production without SKY_RESEND_API_KEY: nothing is sent and nothing is stored as sent. */
export function ingenPost(): Post {
  return { async send() { throw new PostFejl('ingen-udbyder', 'ingen mailudbyder sat op (SKY_RESEND_API_KEY mangler)'); } };
}
