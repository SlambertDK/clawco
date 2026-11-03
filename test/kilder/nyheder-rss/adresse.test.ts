// KC-0137: the URL and IP policy of the RSS fetcher (the SSRF guard).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdresseFejl, klasseAf, normaliserAdresse, sammeNet, tjekAdresse, tjekIp } from '../../../src/kilder/nyheder-rss/adresse.ts';

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

// KC-0274 (C3): the judge's IPv6 gaps. An address that carries or hides an IPv4 address is judged by that address.
test('6to4, NAT64 (both prefixes), SIIT and Teredo are judged by the address they carry', () => {
  const lokaleForme = [
    '2002:7f00:1::', '2002:a00:1::1', '2002:c0a8:101::', '2002:ac10:1::5', // 6to4 of 127.0.0.1, 10.0.0.1, 192.168.1.1, 172.16.0.1
    '64:ff9b::7f00:1', '64:ff9b::a00:1', '64:ff9b::192.168.1.1', // NAT64 well-known prefix
    '64:ff9b:1:7f00:0:100::', '64:ff9b:1:808:8:800::', '64:ff9b:1:c0a8:1:100::', // NAT64 local-use /48 (RFC 8215): local even when it carries a public address
    '::ffff:0:7f00:1', '::ffff:0:a00:1', // SIIT
    '2001:0:7f00:1:0:0:f7f7:f7f7', '2001:0:5ef5:79fd:0:0:80ff:fefe', '2001:0:4136:e378:8000:63bf:80ff:fefe', // Teredo: server 127.0.0.1; client obfuscated 127.0.0.1 (80ff:fefe)
    'fec0::1', 'feff::1', // site-local
  ];
  for (const ip of lokaleForme) {
    assert.throws(() => tjekIp(ip, ekstern), AdresseFejl, `ekstern ${ip}`);
    assert.doesNotThrow(() => tjekIp(ip, bruger), `bruger ${ip}`);
  }
  const forbudteForme = ['2002:a9fe:a9fe::', '64:ff9b::a9fe:a9fe', '::ffff:0:a9fe:a9fe', '2001:0:a9fe:a9fe:0:0:f7f7:f7f7', '64:ff9b:1:a9fe:a9:fe00::', '2001:0:4136:e378:8000:63bf:5601:5601'];
  for (const ip of forbudteForme) {
    assert.throws(() => tjekIp(ip, bruger), AdresseFejl, `bruger ${ip}`);
    assert.throws(() => tjekIp(ip, ekstern), AdresseFejl, `ekstern ${ip}`);
  }
  for (const ip of ['2002:808:808::1', '64:ff9b::808:808', '::ffff:0:808:808', '2001:0:808:808:0:0:f7f7:f7f7', '2001:db8::1', '2606:4700::1111']) {
    assert.doesNotThrow(() => tjekIp(ip, ekstern), ip);
  }
  // The same literals through a URL.
  for (const a of ['http://[2002:7f00:1::]/f', 'http://[64:ff9b:1:7f00:0:100::]/f', 'http://[::ffff:0:7f00:1]/f', 'http://[fec0::1]/f']) {
    assert.throws(() => tjekAdresse(a, ekstern), AdresseFejl, a);
    assert.doesNotThrow(() => tjekAdresse(a, bruger), a);
  }
});

test('198.18.0.0/15, 192.0.0.0/24 and 192.88.99.0/24 are local, their neighbours are public', () => {
  for (const ip of ['198.18.0.1', '198.19.255.254', '192.0.0.1', '192.0.0.170', '192.88.99.1']) {
    assert.throws(() => tjekIp(ip, ekstern), AdresseFejl, `ekstern ${ip}`);
    assert.doesNotThrow(() => tjekIp(ip, bruger), `bruger ${ip}`);
  }
  for (const ip of ['198.17.255.255', '198.20.0.1', '192.0.1.1', '192.88.98.1', '192.88.100.1']) assert.doesNotThrow(() => tjekIp(ip, ekstern), ip);
});

test('sammeNet: the address itself or its /24 (IPv4) or /64 (IPv6); nothing else', () => {
  assert.equal(sammeNet('192.168.1.5', '192.168.1.5'), true);
  assert.equal(sammeNet('192.168.1.200', '192.168.1.5'), true);
  assert.equal(sammeNet('192.168.2.5', '192.168.1.5'), false);
  assert.equal(sammeNet('127.0.0.1', '192.168.1.5'), false);
  assert.equal(sammeNet('fd12:1:2:3::9', 'fd12:1:2:3::1'), true);
  assert.equal(sammeNet('fd12:1:2:4::1', 'fd12:1:2:3::1'), false);
  assert.equal(sammeNet('192.168.1.5', 'fd12:1:2:3::1'), false);
  assert.deepEqual(['127.0.0.1', '8.8.8.8', '169.254.169.254'].map(klasseAf), ['lokal', 'offentlig', 'forbudt']);
});

test('"hostet" is as strict as "ekstern", with words that do not invite the user to type it in', () => {
  for (const a of ['http://127.0.0.1/f', 'http://localhost/f', 'http://192.168.1.5/f', 'http://[::1]/f']) {
    assert.throws(() => tjekAdresse(a, { oprindelse: 'hostet' }), (e: unknown) => e instanceof AdresseFejl && !/Skriv den selv|Type it in/.test(e.message), a);
  }
  assert.doesNotThrow(() => tjekAdresse('https://example.com/feed', { oprindelse: 'hostet' }));
  assert.throws(() => tjekAdresse('http://169.254.169.254/', { oprindelse: 'hostet' }), AdresseFejl);
});
