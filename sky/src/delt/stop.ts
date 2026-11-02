// A stop on SIGTERM/SIGINT that always ends (KC-0221). server.close() alone waits for every open connection,
// and a customer's live-update stream through the gateway never ends by itself: systemd then waits out its
// stop timeout and kills Sky, and the site answers 502 meanwhile. So: stop accepting, close idle keep-alive
// connections at once, give busy requests `frist` ms to finish, then cut the rest (browsers reconnect).
import type { Server } from 'node:http';

export async function stopPaaSignal(o: {
  server: Server;
  /** How long busy requests may finish before their connections are cut. */
  frist: number;
  /** Stops the loops (reconciler, key purge, copies) before the server closes. */
  foer: () => void;
  /** Runs after the server has closed (closes the database). */
  efter: () => Promise<void>;
  log?: (linje: string) => void;
}): Promise<number> {
  const log = o.log ?? ((s: string) => console.log(`sky: ${s}`));
  o.foer();
  const lukket = new Promise<void>((resolve) => { o.server.close(() => resolve()); });
  o.server.closeIdleConnections();
  const skaer = setTimeout(() => { o.server.closeAllConnections(); }, o.frist);
  skaer.unref();
  await lukket;
  clearTimeout(skaer);
  try {
    await o.efter();
    return 0;
  } catch (err) {
    log(`stop: oprydning fejlede: ${(err as Error).message}`);
    return 1;
  }
}
