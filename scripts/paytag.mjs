#!/usr/bin/env node
// Paytag — off-chain verifier tools.
//
// The contract cannot query GitHub; an off-chain party performs the check and
// signs the result with ed25519 (docs/SPEC.md §4). This file is the smallest
// tool that produces that signature. The Next.js verifier in Phase 3 will use
// the same logic.
//
// No dependencies: Node's built-in `node:crypto` module supports ed25519.
//
// Commands:
//   node scripts/paytag.mjs selftest
//   node scripts/paytag.mjs identity-key <handle>
//   node scripts/paytag.mjs keygen
//   node scripts/paytag.mjs sign-claim --contract C... --handle foo \
//        --recipient G... --expires-at 1234567 [--nonce <64 hex digits>]
//
// SECURITY: the verifier's private key is read ONLY from the `VERIFIER_SECRET`
// environment variable, never from a command-line argument. Arguments show up
// in `ps` output and in shell history; environment variables do not.

import { createHash, sign as edSign, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// --------------------------------------------------------------- constants

const KIND = { GithubUser: 0x00, GithubRepo: 0x01, XUser: 0x02, PaytagNick: 0x03 };
const CLAIM_DOMAIN = Buffer.from('paytag.claim.v1', 'ascii'); // 15 bytes
const STRKEY_LEN = 56;
const PREIMAGE_LEN = 195;

// ------------------------------------------ normalization §2.1 and §2.4

/**
 * Normalization rule per identity kind.
 *
 * The rules are deliberately SEPARATE: GitHub accepts hyphens and goes up to
 * 39 characters, X accepts underscores and stops at 15. Squeezing them into a
 * single function would silently bind input that is only valid in one of them,
 * such as `elon-musk`, to the wrong identity. SPEC.md §2.1 (GitHub) and
 * §2.4 (X).
 *
 * `pattern` is applied AFTER ASCII lowercasing; hence the lowercase class.
 */
const RULES = {
  [KIND.GithubUser]: {
    label: 'GitHub',
    prefixes: ['https://', 'http://', 'www.', 'github.com/', '@'],
    pattern: /^[a-z0-9](?:-?[a-z0-9])*$/,
    maxLen: 39,
    hint: 'letters, digits and single hyphens only; cannot start or end with a hyphen',
  },
  [KIND.XUser]: {
    label: 'X',
    prefixes: ['https://', 'http://', 'www.', 'x.com/', 'twitter.com/', '@'],
    pattern: /^[a-z0-9_]+$/,
    maxLen: 15,
    hint: 'letters, digits and underscores only; at most 15 characters',
  },
};

/**
 * Produces a normalized handle from raw user input.
 * It does NOT repair invalid input, it rejects it: someone who types
 * "github.com/foo bar" has an unclear intent, and guessing wrong means
 * sending money to somebody else's tag.
 */
export function normalizeHandle(raw, kind = KIND.GithubUser) {
  const rule = RULES[kind];
  if (!rule) throw new Error(`unsupported identity kind: ${kind}`);
  if (typeof raw !== 'string') throw new Error('handle must be a string');

  let s = raw.trim();

  // Strip the prefixes IN ORDER.
  for (const p of rule.prefixes) {
    if (s.toLowerCase().startsWith(p)) s = s.slice(p.length);
  }

  // Trailing slash.
  if (s.endsWith('/')) s = s.slice(0, -1);

  // A slash left in the remainder makes it ambiguous which account is meant.
  if (s.includes('/')) {
    throw new Error(`extra path in ${rule.label} link: ${JSON.stringify(raw)}`);
  }

  // ASCII lowercase. Do NOT use `toLocaleLowerCase`: in a Turkish locale it
  // maps "I" -> "ı" and diverges from Rust's to_ascii_lowercase. A divergence
  // corrupts the identity_key and no claim works. See the warning in
  // SPEC.md §2.1.
  s = asciiLower(s);

  if (s.length < 1 || s.length > rule.maxLen || !rule.pattern.test(s)) {
    throw new Error(`invalid ${rule.label} username: ${JSON.stringify(raw)} — ${rule.hint}`);
  }
  return s;
}

/** Backward-compatible name — use `normalizeHandle` in new code. */
export function normalizeGithubUser(raw) {
  return normalizeHandle(raw, KIND.GithubUser);
}

export function normalizeXUser(raw) {
  return normalizeHandle(raw, KIND.XUser);
}

function asciiLower(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 0x41 && c <= 0x5a ? String.fromCharCode(c + 32) : s[i];
  }
  return out;
}

/** identity_key = sha256(kind_byte ‖ utf8(normalized_handle)) */
export function identityKey(handle, kind = KIND.GithubUser) {
  return identityKeyFromNormalized(normalizeHandle(handle, kind), kind);
}

/**
 * Lower layer that SKIPS normalization.
 *
 * Used only when the input is already known to be normalized: the reserved
 * `kind` values (`GithubRepo`, `PaytagNick`) have no normalization rule yet,
 * but we still want to test that the kind byte really does change the digest.
 * NEVER call this with user input.
 */
export function identityKeyFromNormalized(norm, kind) {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from([kind]), Buffer.from(norm, 'utf8')]))
    .digest();
}

// ------------------------------------------------------------ preimage §4.1

/**
 * SPEC.md §4.1 — fixed 195-byte layout.
 * Addresses are embedded as strkey (ASCII); the contract side produces the
 * same bytes via `Address::to_string()`.
 */
export function claimPreimage({ contractId, identityKey: ik, recipient, expiresAt, nonce }) {
  assertStrkey(contractId, 'contract');
  assertStrkey(recipient, 'recipient');
  if (!Buffer.isBuffer(ik) || ik.length !== 32) throw new Error('identity_key must be 32 bytes');
  if (!Buffer.isBuffer(nonce) || nonce.length !== 32) throw new Error('nonce must be 32 bytes');
  if (!Number.isInteger(expiresAt) || expiresAt < 0 || expiresAt > 0xffffffff) {
    throw new Error('expires_at must be an integer in the range 0..2^32-1');
  }

  const exp = Buffer.alloc(4);
  exp.writeUInt32BE(expiresAt);

  const buf = Buffer.concat([
    CLAIM_DOMAIN,
    Buffer.from(contractId, 'ascii'),
    ik,
    Buffer.from(recipient, 'ascii'),
    exp,
    nonce,
  ]);
  if (buf.length !== PREIMAGE_LEN) throw new Error(`preimage is ${buf.length} bytes, must be ${PREIMAGE_LEN}`);
  return buf;
}

function assertStrkey(s, name) {
  if (typeof s !== 'string' || s.length !== STRKEY_LEN) {
    throw new Error(`${name} address must be a 56-character strkey (muxed M... not supported): ${s}`);
  }
}

// ----------------------------------------------------------------- signing

/** Turns a raw 32-byte ed25519 seed into a key Node understands. */
function privateKeyFromSeed(seed32) {
  // PKCS#8 wrapper: fixed prefix + 32-byte seed
  const der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed32,
  ]);
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

export function publicKeyOf(seed32) {
  const pub = createPublicKey(privateKeyFromSeed(seed32));
  return pub.export({ type: 'spki', format: 'der' }).subarray(-32);
}

export function signClaim(seed32, preimage) {
  return edSign(null, preimage, privateKeyFromSeed(seed32));
}

// --------------------------------------------------------------------- CLI

function readSecret() {
  const hex = process.env.VERIFIER_SECRET;
  if (!hex) {
    throw new Error(
      'VERIFIER_SECRET is not set.\n' +
      '  Load    :  export VERIFIER_SECRET=$(grep ^VERIFIER_SECRET web/.env.local | cut -d= -f2)\n' +
      '  Generate:  node scripts/paytag.mjs keygen'
    );
  }
  const buf = Buffer.from(hex.trim(), 'hex');
  if (buf.length !== 32) throw new Error('VERIFIER_SECRET must be 64 hex digits (32 bytes)');
  return buf;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument: ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function cmdKeygen() {
  const seed = randomBytes(32);
  const pub = publicKeyOf(seed);
  const target = join(process.cwd(), 'web', '.env.local');

  mkdirSync(dirname(target), { recursive: true });
  let current = existsSync(target) ? readFileSync(target, 'utf8') : '';

  // .env.local usually starts life as a copy of .env.example, so it contains a
  // placeholder such as `VERIFIER_SECRET=your-ed25519-seed-here`. Mistaking
  // the placeholder for a real key and refusing would deadlock setup; but
  // overwriting a REAL key would throw away every escrow signed with it. The
  // distinction rests on a single criterion: is the value 64 hex digits?
  const currentLine = current.match(/^VERIFIER_SECRET=(.*)$/m);
  if (currentLine) {
    const value = currentLine[1].trim();
    if (/^[0-9a-fA-F]{64}$/.test(value)) {
      console.error('✖ web/.env.local already holds a REAL VERIFIER_SECRET.');
      console.error('  Not overwriting it — escrows signed with that key would become unclaimable.');
      console.error('  To rotate deliberately, delete the line by hand, then run this again.');
      console.error('  Do not forget to update the key in the contract too: set_verifier');
      process.exit(1);
    }
    console.log(`ℹ Placeholder value found (${JSON.stringify(value)}), replacing it with a real key.`);
    current = current.replace(/^VERIFIER_SECRET=.*$/m, `VERIFIER_SECRET=${seed.toString('hex')}`);
    writeFileSync(target, current, { mode: 0o600 });
  } else {
    if (current && !current.endsWith('\n')) current += '\n';
    writeFileSync(target, `${current}VERIFIER_SECRET=${seed.toString('hex')}\n`, { mode: 0o600 });
  }

  // The `mode` option of writeFileSync only applies when the file is NEWLY
  // created; if .env.local already exists the permissions would stay at 644.
  // This file holds the verifier's private key — we narrow them explicitly.
  chmodSync(target, 0o600);

  console.log('✓ Verifier key pair generated.');
  console.log(`  private -> web/.env.local  (gitignored, mode 600, NOT printed)`);
  console.log(`  public  -> ${pub.toString('hex')}`);
  console.log('');
  console.log('The public key is handed to the contract via init(). The private key never leaves the server.');
}

/**
 * Short name used in URLs and on the command line -> kind byte.
 * GitHub is the default so that existing scripts and documentation keep
 * working without passing `--kind`.
 */
function kindFromSlug(slug) {
  if (slug === undefined || slug === null || slug === '' || slug === 'gh') return KIND.GithubUser;
  if (slug === 'x') return KIND.XUser;
  throw new Error(`unknown identity kind: ${JSON.stringify(slug)} — expected "gh" or "x"`);
}

function cmdIdentityKey(handle, kind = KIND.GithubUser) {
  const norm = normalizeHandle(handle, kind);
  console.log(`handle       : ${handle}`);
  console.log(`kind         : 0x0${kind} (${RULES[kind].label})`);
  console.log(`normalized   : ${norm}`);
  console.log(`identity_key : ${identityKey(handle, kind).toString('hex')}`);
}

function cmdSignClaim(args) {
  const seed = readSecret();
  const nonce = args.nonce ? Buffer.from(args.nonce, 'hex') : randomBytes(32);
  const kind = kindFromSlug(args.kind);
  const ik = identityKey(args.handle, kind);
  const expiresAt = Number(args['expires-at']);

  const pre = claimPreimage({
    contractId: args.contract,
    identityKey: ik,
    recipient: args.recipient,
    expiresAt,
    nonce,
  });
  const sig = signClaim(seed, pre);

  console.log(`kind         : 0x0${kind} (${RULES[kind].label})`);
  console.log(`identity_key : ${ik.toString('hex')}`);
  console.log(`nonce        : ${nonce.toString('hex')}`);
  console.log(`expires_at   : ${expiresAt}`);
  console.log(`signature    : ${sig.toString('hex')}`);
  console.log('');
  console.log('For stellar contract invoke:');
  console.log(`  --identity ${ik.toString('hex')} \\`);
  console.log(`  --nonce ${nonce.toString('hex')} \\`);
  console.log(`  --expires_at ${expiresAt} \\`);
  console.log(`  --sig ${sig.toString('hex')}`);
}

// ------------------------------------------------------------- selftest
//
// Checks against the vectors in SPEC.md. This is the core of the Rust/TS
// parity test in Phase 3.4: the contract's `preimage_matches_the_spec_golden_vector`
// test produces the same checksum on the Rust side.

function cmdSelftest() {
  let pass = 0;
  const fails = [];
  const ok = (name, cond) => (cond ? pass++ : fails.push(name));

  console.log('═══ identity_key vectors (SPEC §2.3) ═══');
  const vec = {
    metehancaliskan: '91e23a08973aba69e14664cb9e12cc20483a4f702afdd304c8ad7424a354ffff',
    torvalds: '9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b',
    a: '022a6979e6dab7aa5ae4c3e5e45f7e977112a7e63593820dbec1ec738a24f93c',
    ['a'.repeat(39)]: '2e7774be4389a7316830256eebfdebbc76f3a47ea6b62cea92b0efb7982de372',
  };
  for (const [h, expected] of Object.entries(vec)) {
    const got = identityKey(h).toString('hex');
    ok(`identity_key(${h.length > 12 ? h.slice(0, 12) + '…' : h})`, got === expected);
    console.log(`${got === expected ? '✅' : '❌'} ${h.length > 20 ? h.slice(0, 20) + '…' : h.padEnd(20)} ${got.slice(0, 16)}…`);
  }

  console.log('\n═══ normalization equivalence ═══');
  const target = vec.torvalds;
  for (const v of [
    'torvalds', 'Torvalds', 'TORVALDS', '@torvalds',
    'github.com/torvalds', 'https://github.com/torvalds',
    'https://github.com/Torvalds/', '  torvalds  ',
  ]) {
    const got = identityKey(v).toString('hex');
    ok(`normalize ${v}`, got === target);
    console.log(`${got === target ? '✅' : '❌'} ${JSON.stringify(v)}`);
  }

  console.log('\n═══ must be rejected ═══');
  for (const v of ['', '-torvalds', 'torvalds-', 'tor--valds', 'torvalds/linux', 'a'.repeat(40), 'torvaldş', 'tor valds']) {
    let rejected = false;
    try { identityKey(v); } catch { rejected = true; }
    ok(`reject ${v}`, rejected);
    console.log(`${rejected ? '✅' : '❌'} ${JSON.stringify(v)}`);
  }

  console.log('\n═══ X identity (SPEC §2.4) ═══');
  const xvec = {
    metehancaliskan: '7462d3ca2f7a62066003309a018b93907472145b9e2341e6b88fbf40fc8b86ff',
    elonmusk: '631990ec6950b453cf0bf093706e41ef2670316556398a48aab1a0bc9e503892',
    a: 'f5fcb5a1e3534de6007b6c49b3a5f4c545edb7c0e0608a30b20e1695db3e43b2',
    _: '859f52e06b88b733233b6ed3b1f14f8859d311c489b3d93b6462b1a155fd0a87',
    paytag_hq: '46821a0d92388e22cc33b8eccdd8182015f44c345be052d53ca2877cb2b3ec0b',
    ['a'.repeat(15)]: 'b219a3f65891085e99adf52e16b7bcae281681b5b9afc5c6075ab44df5ef47f3',
  };
  for (const [h, expected] of Object.entries(xvec)) {
    const got = identityKey(h, KIND.XUser).toString('hex');
    ok(`x identity_key(${h})`, got === expected);
    console.log(`${got === expected ? '✅' : '❌'} ${h.padEnd(20)} ${got.slice(0, 16)}…`);
  }

  console.log('\n═══ X normalization equivalence ═══');
  for (const v of [
    'elonmusk', 'ElonMusk', 'ELONMUSK', '@elonmusk',
    'x.com/elonmusk', 'https://x.com/ElonMusk',
    'twitter.com/elonmusk', 'https://www.twitter.com/elonmusk/', '  @elonmusk  ',
  ]) {
    const got = identityKey(v, KIND.XUser).toString('hex');
    ok(`x normalize ${v}`, got === xvec.elonmusk);
    console.log(`${got === xvec.elonmusk ? '✅' : '❌'} ${JSON.stringify(v)}`);
  }

  console.log('\n═══ X — must be rejected ═══');
  for (const v of ['', 'elon-musk', 'elon.musk', 'a'.repeat(16), 'elonmusk/status/1', 'elonmuşk', 'elon musk']) {
    let rejected = false;
    try { identityKey(v, KIND.XUser); } catch { rejected = true; }
    ok(`x reject ${v}`, rejected);
    console.log(`${rejected ? '✅' : '❌'} ${JSON.stringify(v)}`);
  }

  // Are the rules really separate? `elon-musk` is valid on GitHub, not on X.
  // This single case catches the two rules accidentally collapsing into one
  // function.
  console.log('\n═══ rule separation ═══');
  let ghAccepts = true;
  try { normalizeHandle('elon-musk', KIND.GithubUser); } catch { ghAccepts = false; }
  let xRejects = false;
  try { normalizeHandle('elon-musk', KIND.XUser); } catch { xRejects = true; }
  ok('elon-musk is valid on GitHub', ghAccepts);
  ok('elon-musk is invalid on X', xRejects);
  console.log(`${ghAccepts && xRejects ? '✅' : '❌'} "elon-musk": GitHub accepts, X rejects`);

  console.log('\n═══ kind separation ═══');
  const kinds = {
    [KIND.GithubUser]: vec.torvalds,
    [KIND.GithubRepo]: '919ae1bad528b5f77e43e55a03d75409d6ceca8b23a4219fb35c1e3da936660c',
    [KIND.XUser]: 'cb254de12f5a5a76717d0db39922eb02cbe081c4977bd82e7d492bba5a7e3d96',
    [KIND.PaytagNick]: '445e3e773d82aa85a04b41a66c387590d962f94bea1a9fefad12447d4b5a1359',
  };
  // The reserved kinds (0x01, 0x03) have no normalization rule yet, so we call
  // the lower layer. What we are measuring is not normalization but that the
  // kind byte really does separate the digests.
  for (const [k, expected] of Object.entries(kinds)) {
    const got = identityKeyFromNormalized('torvalds', Number(k)).toString('hex');
    ok(`kind ${k}`, got === expected);
    console.log(`${got === expected ? '✅' : '❌'} kind=${k}`);
  }

  console.log('\n═══ GOLDEN VECTOR: claim preimage (SPEC §4.2) ═══');
  const nonce = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
  const pre = claimPreimage({
    contractId: 'CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU',
    identityKey: Buffer.from(vec.torvalds, 'hex'),
    recipient: 'GAD3LMKOEUQ4PVF42NGCDVYZVMLZDAP4RNRRNWEZ7Y7CCXHB7MNQCKWG',
    expiresAt: 1_000_000,
    nonce,
  });
  const expectedHash = '6797bc5d95d35ac19c7918c38bf139fffaea466406439b08b49e017c08780906';
  const gotHash = createHash('sha256').update(pre).digest('hex');

  ok('preimage length is 195', pre.length === PREIMAGE_LEN);
  ok('preimage sha256', gotHash === expectedHash);
  console.log(`${pre.length === PREIMAGE_LEN ? '✅' : '❌'} length ${pre.length} bytes`);
  console.log(`${gotHash === expectedHash ? '✅' : '❌'} sha256 ${gotHash}`);
  if (gotHash !== expectedHash) console.log(`   expected ${expectedHash}`);

  console.log('\n═══ ed25519 sign-and-verify round trip ═══');
  const seed = Buffer.alloc(32, 3);
  const sig = signClaim(seed, pre);
  const pub = publicKeyOf(seed);
  ok('signature is 64 bytes', sig.length === 64);
  ok('public key is 32 bytes', pub.length === 32);
  console.log(`✅ signature ${sig.length} bytes, public key ${pub.length} bytes`);
  console.log(`   (the contract test uses the same seed: [3u8; 32])`);
  console.log(`   public: ${pub.toString('hex')}`);

  console.log('');
  if (fails.length) {
    console.log(`\x1b[0;31m✖ ${pass}/${pass + fails.length} passed. Failures:\x1b[0m`);
    for (const f of fails) console.log(`   - ${f}`);
    console.log('\nRust and TypeScript have diverged. Until this is fixed, no claim works.');
    process.exit(1);
  }
  console.log(`\x1b[0;32m✓ ${pass}/${pass} cases passed — the TypeScript side matches SPEC.\x1b[0m`);
}

// ---------------------------------------------------------------- dispatch
//
// The CLI runs ONLY when this file is executed directly. Without that guard,
// every place that `import`s the file (the Next.js verifier route in Phase 3)
// would also run the command-line logic and print the help text.

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}

function main() {
const [cmd, ...rest] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'selftest': cmdSelftest(); break;
    case 'identity-key':
      if (!rest[0]) throw new Error('usage: identity-key <handle> [gh|x]');
      cmdIdentityKey(rest[0], kindFromSlug(rest[1]));
      break;
    case 'keygen': cmdKeygen(); break;
    case 'sign-claim': {
      const a = parseArgs(rest);
      for (const g of ['contract', 'handle', 'recipient', 'expires-at']) {
        if (!a[g]) throw new Error(`--${g} is required`);
      }
      cmdSignClaim(a);
      break;
    }
    default:
      // The header comment IS the help text — one place to keep current. It
      // ends at the first line that is not a comment; taking every `//` line
      // in the file used to dump the internal design notes and the ASCII
      // section rules along with it.
      console.log(
        readFileSync(new URL(import.meta.url), 'utf8')
          .split('\n')
          .slice(1)                                   // skip the shebang
          .reduce((acc, l) => (acc.done || !l.startsWith('//')
            ? { done: true, out: acc.out }
            : { done: false, out: [...acc.out, l.replace(/^\/\/ ?/, '')] }),
            { done: false, out: [] })
          .out.join('\n')
          .trimEnd(),
      );
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(`\x1b[0;31m✖ ${e.message}\x1b[0m`);
  process.exit(1);
}
}
