#!/usr/bin/env node
// Paytag — off-chain verifier araçları.
//
// Kontrat GitHub'a soramaz; doğrulamayı off-chain bir taraf yapıp sonucu
// ed25519 ile imzalar (docs/SPEC.md §4). Bu dosya o imzayı üreten en küçük
// araç. Faz 3'teki Next.js verifier'ı aynı mantığı kullanacak.
//
// Bağımlılık yok: Node'un yerleşik `node:crypto` modülü ed25519 destekliyor.
//
// Komutlar:
//   node scripts/paytag.mjs selftest
//   node scripts/paytag.mjs identity-key <handle>
//   node scripts/paytag.mjs keygen
//   node scripts/paytag.mjs sign-claim --contract C... --handle foo \
//        --recipient G... --expires-at 1234567 [--nonce <64 hane hex>]
//
// GÜVENLİK: verifier'ın private key'i YALNIZCA `VERIFIER_SECRET` ortam
// değişkeninden okunur, asla komut satırı argümanından. Argümanlar `ps`
// çıktısında ve kabuk geçmişinde görünür; ortam değişkeni görünmez.

import { createHash, sign as edSign, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------- sabitler

const KIND = { GithubUser: 0x00, GithubRepo: 0x01, XUser: 0x02, PaytagNick: 0x03 };
const CLAIM_DOMAIN = Buffer.from('paytag.claim.v1', 'ascii'); // 15 bayt
const STRKEY_LEN = 56;
const PREIMAGE_LEN = 195;

// ------------------------------------------------------- normalizasyon §2.1

/**
 * SPEC.md §2.1 — ham kullanıcı girdisinden normalized handle üretir.
 * Geçersiz girdiyi DÜZELTMEZ, reddeder: "github.com/foo bar" yazan birinin
 * niyeti belirsizdir ve yanlış tahmin, parayı başkasının etiketine yollamaktır.
 */
export function normalizeGithubUser(raw) {
  if (typeof raw !== 'string') throw new Error('handle bir metin olmalı');

  let s = raw.trim();

  // Önekleri SIRAYLA soy.
  for (const p of ['https://', 'http://', 'www.', 'github.com/', '@']) {
    if (s.toLowerCase().startsWith(p)) s = s.slice(p.length);
  }

  // Sondaki eğik çizgi.
  if (s.endsWith('/')) s = s.slice(0, -1);

  // Kalanda eğik çizgi varsa bu bir repo; MVP kapsamı dışı.
  if (s.includes('/')) {
    throw new Error(`repo biçimi desteklenmiyor (MVP yalnızca GitHub kullanıcısı): ${raw}`);
  }

  // ASCII küçük harf. `toLocaleLowerCase` KULLANMA: Türkçe yerel ayarda
  // "I" -> "ı" verir ve Rust'ın to_ascii_lowercase'i ile ayrışır. Ayrışma
  // identity_key'i bozar, hiçbir claim çalışmaz. SPEC.md §2.1 uyarısı.
  s = asciiLower(s);

  if (!/^[a-zA-Z0-9](?:-?[a-zA-Z0-9])*$/.test(s) || s.length < 1 || s.length > 39) {
    throw new Error(`geçersiz GitHub kullanıcı adı: ${JSON.stringify(raw)}`);
  }
  return s;
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
  const norm = normalizeGithubUser(handle);
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from([kind]), Buffer.from(norm, 'utf8')]))
    .digest();
}

// ------------------------------------------------------------- preimage §4.1

/**
 * SPEC.md §4.1 — 195 baytlık sabit düzen.
 * Adresler strkey (ASCII) olarak gömülür; kontrat tarafında da
 * `Address::to_string()` ile aynı baytlar üretilir.
 */
export function claimPreimage({ contractId, identityKey: ik, recipient, expiresAt, nonce }) {
  assertStrkey(contractId, 'contract');
  assertStrkey(recipient, 'recipient');
  if (!Buffer.isBuffer(ik) || ik.length !== 32) throw new Error('identity_key 32 bayt olmalı');
  if (!Buffer.isBuffer(nonce) || nonce.length !== 32) throw new Error('nonce 32 bayt olmalı');
  if (!Number.isInteger(expiresAt) || expiresAt < 0 || expiresAt > 0xffffffff) {
    throw new Error('expires_at 0..2^32-1 aralığında bir tamsayı olmalı');
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
  if (buf.length !== PREIMAGE_LEN) throw new Error(`preimage ${buf.length} bayt, ${PREIMAGE_LEN} olmalı`);
  return buf;
}

function assertStrkey(s, adi) {
  if (typeof s !== 'string' || s.length !== STRKEY_LEN) {
    throw new Error(`${adi} adresi 56 karakterlik strkey olmalı (muxed M... desteklenmiyor): ${s}`);
  }
}

// ---------------------------------------------------------------- imzalama

/** Ham 32 baytlık ed25519 seed'i Node'un anlayacağı anahtara çevirir. */
function privateKeyFromSeed(seed32) {
  // PKCS#8 sarmalayıcı: sabit önek + 32 baytlık seed
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

// ------------------------------------------------------------------- CLI

function readSecret() {
  const hex = process.env.VERIFIER_SECRET;
  if (!hex) {
    throw new Error(
      'VERIFIER_SECRET tanımlı değil.\n' +
      '  Yükle:  export VERIFIER_SECRET=$(grep ^VERIFIER_SECRET web/.env.local | cut -d= -f2)\n' +
      '  Üret :  node scripts/paytag.mjs keygen'
    );
  }
  const buf = Buffer.from(hex.trim(), 'hex');
  if (buf.length !== 32) throw new Error('VERIFIER_SECRET 64 hane hex (32 bayt) olmalı');
  return buf;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`beklenmeyen argüman: ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function cmdKeygen() {
  const seed = randomBytes(32);
  const pub = publicKeyOf(seed);
  const target = join(process.cwd(), 'web', '.env.local');

  mkdirSync(dirname(target), { recursive: true });
  let mevcut = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (/^VERIFIER_SECRET=/m.test(mevcut)) {
    console.error('✖ web/.env.local içinde zaten bir VERIFIER_SECRET var.');
    console.error('  Üzerine yazmıyorum — mevcut anahtarla imzalanmış emanetler geçersiz kalırdı.');
    process.exit(1);
  }
  if (mevcut && !mevcut.endsWith('\n')) mevcut += '\n';
  writeFileSync(target, `${mevcut}VERIFIER_SECRET=${seed.toString('hex')}\n`, { mode: 0o600 });

  console.log('✓ Verifier anahtar çifti üretildi.');
  console.log(`  private -> web/.env.local  (gitignore'da, mod 600, ekrana YAZILMADI)`);
  console.log(`  public  -> ${pub.toString('hex')}`);
  console.log('');
  console.log('Public key kontrata init() ile verilir. Private key sunucudan çıkmaz.');
}

function cmdIdentityKey(handle) {
  const norm = normalizeGithubUser(handle);
  console.log(`handle       : ${handle}`);
  console.log(`normalized   : ${norm}`);
  console.log(`identity_key : ${identityKey(handle).toString('hex')}`);
}

function cmdSignClaim(args) {
  const seed = readSecret();
  const nonce = args.nonce ? Buffer.from(args.nonce, 'hex') : randomBytes(32);
  const ik = identityKey(args.handle);
  const expiresAt = Number(args['expires-at']);

  const pre = claimPreimage({
    contractId: args.contract,
    identityKey: ik,
    recipient: args.recipient,
    expiresAt,
    nonce,
  });
  const sig = signClaim(seed, pre);

  console.log(`identity_key : ${ik.toString('hex')}`);
  console.log(`nonce        : ${nonce.toString('hex')}`);
  console.log(`expires_at   : ${expiresAt}`);
  console.log(`signature    : ${sig.toString('hex')}`);
  console.log('');
  console.log('stellar contract invoke için:');
  console.log(`  --identity ${ik.toString('hex')} \\`);
  console.log(`  --nonce ${nonce.toString('hex')} \\`);
  console.log(`  --expires_at ${expiresAt} \\`);
  console.log(`  --sig ${sig.toString('hex')}`);
}

// ------------------------------------------------------------- selftest
//
// SPEC.md'deki vektörlere karşı doğrular. Bu, Faz 3.4'teki Rust/TS parity
// testinin çekirdeği: kontrattaki `preimage_spec_altin_vektorune_uyuyor`
// testi aynı sağlamayı Rust tarafında üretiyor.

function cmdSelftest() {
  let pass = 0;
  const fails = [];
  const ok = (ad, kosul) => (kosul ? pass++ : fails.push(ad));

  console.log('═══ identity_key vektörleri (SPEC §2.3) ═══');
  const vec = {
    metehancaliskan: '91e23a08973aba69e14664cb9e12cc20483a4f702afdd304c8ad7424a354ffff',
    torvalds: '9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b',
    a: '022a6979e6dab7aa5ae4c3e5e45f7e977112a7e63593820dbec1ec738a24f93c',
    ['a'.repeat(39)]: '2e7774be4389a7316830256eebfdebbc76f3a47ea6b62cea92b0efb7982de372',
  };
  for (const [h, beklenen] of Object.entries(vec)) {
    const got = identityKey(h).toString('hex');
    ok(`identity_key(${h.length > 12 ? h.slice(0, 12) + '…' : h})`, got === beklenen);
    console.log(`${got === beklenen ? '✅' : '❌'} ${h.length > 20 ? h.slice(0, 20) + '…' : h.padEnd(20)} ${got.slice(0, 16)}…`);
  }

  console.log('\n═══ normalizasyon eşdeğerliği ═══');
  const hedef = vec.torvalds;
  for (const v of [
    'torvalds', 'Torvalds', 'TORVALDS', '@torvalds',
    'github.com/torvalds', 'https://github.com/torvalds',
    'https://github.com/Torvalds/', '  torvalds  ',
  ]) {
    const got = identityKey(v).toString('hex');
    ok(`normalize ${v}`, got === hedef);
    console.log(`${got === hedef ? '✅' : '❌'} ${JSON.stringify(v)}`);
  }

  console.log('\n═══ reddedilmesi gerekenler ═══');
  for (const v of ['', '-torvalds', 'torvalds-', 'tor--valds', 'torvalds/linux', 'a'.repeat(40), 'torvaldş', 'tor valds']) {
    let reddetti = false;
    try { identityKey(v); } catch { reddetti = true; }
    ok(`reject ${v}`, reddetti);
    console.log(`${reddetti ? '✅' : '❌'} ${JSON.stringify(v)}`);
  }

  console.log('\n═══ kind ayrımı ═══');
  const kinds = {
    [KIND.GithubUser]: vec.torvalds,
    [KIND.GithubRepo]: '919ae1bad528b5f77e43e55a03d75409d6ceca8b23a4219fb35c1e3da936660c',
    [KIND.XUser]: 'cb254de12f5a5a76717d0db39922eb02cbe081c4977bd82e7d492bba5a7e3d96',
    [KIND.PaytagNick]: '445e3e773d82aa85a04b41a66c387590d962f94bea1a9fefad12447d4b5a1359',
  };
  for (const [k, beklenen] of Object.entries(kinds)) {
    const got = identityKey('torvalds', Number(k)).toString('hex');
    ok(`kind ${k}`, got === beklenen);
    console.log(`${got === beklenen ? '✅' : '❌'} kind=${k}`);
  }

  console.log('\n═══ ALTIN VEKTÖR: claim preimage (SPEC §4.2) ═══');
  const nonce = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
  const pre = claimPreimage({
    contractId: 'CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU',
    identityKey: Buffer.from(vec.torvalds, 'hex'),
    recipient: 'GAD3LMKOEUQ4PVF42NGCDVYZVMLZDAP4RNRRNWEZ7Y7CCXHB7MNQCKWG',
    expiresAt: 1_000_000,
    nonce,
  });
  const beklenenHash = '6797bc5d95d35ac19c7918c38bf139fffaea466406439b08b49e017c08780906';
  const gotHash = createHash('sha256').update(pre).digest('hex');

  ok('preimage uzunluğu 195', pre.length === PREIMAGE_LEN);
  ok('preimage sha256', gotHash === beklenenHash);
  console.log(`${pre.length === PREIMAGE_LEN ? '✅' : '❌'} uzunluk ${pre.length} bayt`);
  console.log(`${gotHash === beklenenHash ? '✅' : '❌'} sha256 ${gotHash}`);
  if (gotHash !== beklenenHash) console.log(`   beklenen ${beklenenHash}`);

  console.log('\n═══ ed25519 imza-doğrulama turu ═══');
  const seed = Buffer.alloc(32, 3);
  const sig = signClaim(seed, pre);
  const pub = publicKeyOf(seed);
  ok('imza 64 bayt', sig.length === 64);
  ok('public key 32 bayt', pub.length === 32);
  console.log(`✅ imza ${sig.length} bayt, public key ${pub.length} bayt`);
  console.log(`   (kontrattaki test aynı seed'i kullanıyor: [3u8; 32])`);
  console.log(`   public: ${pub.toString('hex')}`);

  console.log('');
  if (fails.length) {
    console.log(`\x1b[0;31m✖ ${pass}/${pass + fails.length} geçti. Başarısız:\x1b[0m`);
    for (const f of fails) console.log(`   - ${f}`);
    console.log('\nRust ve TypeScript ayrıştı. Bu düzeltilmeden hiçbir claim çalışmaz.');
    process.exit(1);
  }
  console.log(`\x1b[0;32m✓ ${pass}/${pass} vaka geçti — TypeScript tarafı SPEC ile uyumlu.\x1b[0m`);
}

// ---------------------------------------------------------------- dispatch
//
// CLI YALNIZCA doğrudan çalıştırıldığında koşar. Bu koruma olmadan dosyayı
// `import` eden her yerde (Faz 3'te Next.js verifier route'u) komut satırı
// mantığı da çalışır ve yardım metni basardı.

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}

function main() {
const [cmd, ...rest] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'selftest': cmdSelftest(); break;
    case 'identity-key':
      if (!rest[0]) throw new Error('kullanım: identity-key <handle>');
      cmdIdentityKey(rest[0]);
      break;
    case 'keygen': cmdKeygen(); break;
    case 'sign-claim': {
      const a = parseArgs(rest);
      for (const g of ['contract', 'handle', 'recipient', 'expires-at']) {
        if (!a[g]) throw new Error(`--${g} zorunlu`);
      }
      cmdSignClaim(a);
      break;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url)).toString().split('\n')
        .filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(`\x1b[0;31m✖ ${e.message}\x1b[0m`);
  process.exit(1);
}
}
