// Marks an error that means "Hermes' answer could not be used" (missing or
// malformed JSON), as opposed to anything else that can go wrong after a run.
// Only this kind sends the answer back to Hermes for one correction (KC-0050);
// every other error fails the run, so a handling is never repeated.

export class SvarFejl extends Error {
  constructor(message: string) { super(message); this.name = 'SvarFejl'; }
}
