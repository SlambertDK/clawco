// Key material as a type that never prints its bytes (KC-0181). The bytes sit behind an ES private
// field; String(), template strings, JSON.stringify, util.inspect and util.format all give `[nøgle]`.
// Only aaben() hands out the bytes, and only crypto calls and the delivery to a container use it.
import { inspect } from 'node:util';

export const SKJULT = '[nøgle]';

export class Hemmelig {
  #v: Buffer;
  constructor(v: Buffer) { this.#v = v; }
  /** The raw bytes. Never log, render or put them in an error. */
  aaben(): Buffer { return this.#v; }
  /** Safe to print (scripts say key name and length only, AGENTS §9). */
  get laengde(): number { return this.#v.length; }
  /** Zeroes the bytes once they are no longer needed. */
  oedelaeg(): void { this.#v.fill(0); }
  toString(): string { return SKJULT; }
  toJSON(): string { return SKJULT; }
  [Symbol.toPrimitive](): string { return SKJULT; }
  [inspect.custom](): string { return SKJULT; }
}

/** Wraps key bytes (takes ownership: the caller keeps no other reference). */
export function skjul(bytes: Buffer): Hemmelig { return new Hemmelig(bytes); }
