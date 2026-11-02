// KC-0137: the URL and IP policy of the RSS fetcher (the SSRF guard).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdresseFejl, normaliserAdresse, tjekAdresse, tjekIp } from '../../../src/kilder/nyheder-rss/adresse.ts';

const bruger = { oprindelse: 'bruger' } as const;
const ekstern = { oprindelse: 'ekstern' } as const;

test('refuses every scheme but http and https, and credentials in the URL', () => {
  for (const a of ['ftp://x.example/f', 'javascript:alert(1)', 'data:text/plain,hej', 'file:///etc/passwd', 'https://u:p@x.example/f', 'https://u@x.example/f']) {
    assert.throws(() => tjekAdresse(a, bruger), AdresseFejl, a);
  }
});

test('refuses link-local, metadata and unspecified targets whoever typed them', () => {
  for (const a of ['http://169.254.169.254/', 'http://169.254.1.1/f', 'http://[fe80::1]/', 'http://[::ffff:169.254.169.254]/', 'http://metadata.google.internal/', 'http://metadata.goog/', 'http://[fd00:ec2::254]/', 'http://100.100.100.200/', 'http://0.0.0.0/', 'http://[::]/', 'http://224.0.0.1/']) {
    assert.throws(() => tjekAdresse(a, bruger), AdresseFejl, `bruger ${a}`);
    assert.throws(() => tjekAdresse(a, ekstern), AdresseFejl, `ekstern ${a}`);
  }
  // Obfuscated forms normalise to the same address in the URL parser.
  assert.throws(() => tjekAdresse('http://2852039166/', bruger), AdresseFejl);
  assert.throws(() => tjekAdresse('http://0xa9fea9fe/', bruger), AdresseFejl);
});

test('loopback and LAN only for what the user pasted', () => {
  for (const a of ['http://127.0.0.1:8801/f', 'http://localhost:8801/f', 'http://192.168.1.5/f', 'http://[::1]/f', 'http://10.1.2.3/f']) {
    assert.doesNotThrow(() => tjekAdresse(a, bruger), a);
    assert.throws(() => tjekAdresse(a, ekstern), AdresseFejl, a);
  }
  for (const a of ['http://172.16.0.1/', 'http://100.64.0.1/', 'http://[fd12::1]/']) assert.throws(() => tjekAdresse(a, ekstern), AdresseFejl, a);
  assert.doesNotThrow(() => tjekAdresse('https://example.com/feed', ekstern));
});

test('a pasted address without a scheme gets https', () => {
  assert.equal(tjekAdresse('example.com/feed', bruger).href, 'https://example.com/feed');
  assert.equal(tjekAdresse('  https://example.com/feed \n', bruger).href, 'https://example.com/feed');
});

test('tjekIp judges a resolved address', () => {
  assert.throws(() => tjekIp('169.254.169.254', bruger), AdresseFejl);
  assert.throws(() => tjekIp('::ffff:169.254.169.254', bruger), AdresseFejl);
  assert.throws(() => tjekIp('fe80::1', bruger), AdresseFejl);
  assert.doesNotThrow(() => tjekIp('127.0.0.1', bruger));
  assert.throws(() => tjekIp('127.0.0.1', ekstern), AdresseFejl);
  assert.throws(() => tjekIp('::ffff:127.0.0.1', ekstern), AdresseFejl);
  assert.doesNotThrow(() => tjekIp('93.184.216.34', ekstern));
  assert.doesNotThrow(() => tjekIp('2606:2800:220:1:248:1893:25c8:1946', ekstern));
});

test('normaliserAdresse merges the same address written two ways', () => {
  assert.equal(normaliserAdresse(new URL('HTTP://Example.com:80/a#x')), normaliserAdresse(new URL('http://example.com/a')));
  assert.notEqual(normaliserAdresse(new URL('http://example.com/a')), normaliserAdresse(new URL('http://example.com/b')));
});
