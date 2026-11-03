// KC-0127: why a model test failed, in one fixed Danish sentence per kind. The
// error text from Hermes or the provider only decides the kind; it is never
// shown or stored, because a provider body can echo a fragment of the key.

// KC-0180: the direct-model agent (src/agent/direkte.ts) fails with these sentences themselves (injected by the
// composition root); a fixed sentence maps back to its own kind before any rule is tried.

export type ModelFejlArt = 'noegle' | 'kredit' | 'model' | 'forbindelse' | 'tid' | 'agent-noegle' | 'agent-afvist' | 'model-noegle' | 'kun-hermes' | 'github' | 'vaerktoej' | 'copilot-start' | 'tom' | 'ukendt';

export const MODEL_FEJL: Record<ModelFejlArt, string> = {
  noegle: 'Nøglen er afvist. Tjek, at du har kopieret hele nøglen, og at den stadig findes hos udbyderen.',
  kredit: 'Kontoen hos udbyderen har ikke mere kredit. Fyld op hos udbyderen, og prøv igen.',
  model: 'Udbyderen kender ikke modellen. Vælg en anden model.',
  forbindelse: 'Serveren svarer ikke. Tjek, at den kører, og at adressen er rigtig.',
  tid: 'Modellen svarede ikke inden for 20 sekunder.',
  'agent-noegle': 'Clawco har ingen nøgle til Hermes endnu.',
  'agent-afvist': 'Hermes afviste Clawcos nøgle. Tjek nøglen til Hermes.',
  'model-noegle': 'Clawco har ingen nøgle til en sprogmodel endnu. Vælg en udbyder, og indsæt din nøgle i Start.',
  'kun-hermes': 'Den udbyder virker kun gennem Hermes. Vælg en anden udbyder i Start.',
  // KC-0263: the Copilot transport (src/agent/copilot.ts).
  github: 'GitHub Copilot afviste adgangen. Tjek, at din GitHub-konto har Copilot, og log ind med GitHub igen i Start.',
  vaerktoej: 'Modellen forsøgte at bruge et værktøj, og det må den ikke her. Kørslen blev stoppet.',
  'copilot-start': 'GitHub Copilot kunne ikke starte på denne maskine. Prøv igen om lidt.',
  tom: 'Modellen svarede, men uden tekst.',
  ukendt: 'Modellen svarede ikke som ventet. Prøv igen om lidt.',
};

export const erModelFejlArt = (v: unknown): v is ModelFejlArt => typeof v === 'string' && Object.hasOwn(MODEL_FEJL, v);

// The agent's own connection errors come in the screen language (src/agent), so both are matched.
// Checked in this order: Clawco's own link to Hermes first, then time, then what the provider said.
const REGLER: [ModelFejlArt, RegExp][] = [
  ['agent-noegle', /ingen nøgle til Hermes|no key to Hermes/i],
  ['agent-afvist', /^Hermes (?:afviste kørslen|rejected the run): HTTP 40[13]\b/],
  ['tid', /timed? ?out|svarede ikke i tide|ETIMEDOUT|deadline exceeded/i],
  ['noegle', /\b40[13]\b|unauthori[sz]ed|forbidden|invalid[ _-]?(?:x-)?api[ _-]?key|incorrect api key|authentication|permission denied/i],
  ['kredit', /\b402\b|insufficient|credit|quota|billing|payment required/i],
  ['model', /\b404\b|model[ _-]?not[ _-]?found|does not exist|unknown model|no such model/i],
  ['forbindelse', /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|fetch failed|connection (?:error|refused)|getaddrinfo|socket hang up/i],
];

/** The kind of failure; `tid` when the test's own timer stopped the run. */
export function modelFejlArt(besked: string, o: { tid?: boolean } = {}): ModelFejlArt {
  if (o.tid) return 'tid';
  const fast = (Object.keys(MODEL_FEJL) as ModelFejlArt[]).find((art) => MODEL_FEJL[art] === besked);
  if (fast) return fast;
  for (const [art, re] of REGLER) if (re.test(besked)) return art;
  return 'ukendt';
}
