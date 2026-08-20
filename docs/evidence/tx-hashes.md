# Kanıt — işlem hash'leri

Her deliverable için zincir üstünde doğrulanabilir kayıtlar.

**Ağ:** Stellar Testnet — passphrase `Test SDF Network ; September 2015`
**RPC:** `https://soroban-testnet.stellar.org` · **Protokol:** 27
**Geliştirme kimliği:** `GAD3LMKOEUQ4PVF42NGCDVYZVMLZDAP4RNRRNWEZ7Y7CCXHB7MNQCKWG` (public adres)

> **Testnet sıfırlanır.** SDF testnet'i yılda 2–4 kez sıfırlar; hesaplar,
> bakiyeler, deploy edilmiş kontratlar ve tüm işlem geçmişi silinir. Bir
> sonraki planlı sıfırlama: **16 Aralık 2026**. O tarihten sonra aşağıdaki
> explorer linkleri ölür. Bu yüzden kalıcı kanıt olarak ekran görüntüleri
> (`docs/evidence/screenshots/`) ve komut çıktıları da saklanır.

---

## Faz 0.4 — Araç zinciri kanıtı (throwaway kontrat)

**Tarih:** 20.08.2026

Amaç: iş mantığı yazmadan önce Rust → wasm → deploy → invoke zincirinin
çalıştığını kanıtlamak. Faz 2'nin ortasında "deploy neden patlıyor" ile
uğraşmak, 30 günlük bir sprintte yapılabilecek en pahalı hatadır.

Bu kontrat yalnızca `ping()` içerir ve Faz 2'de gerçek escrow mantığıyla
tamamen değiştirilecektir.

### Derleme

```
Wasm File:  target/wasm32v1-none/release/paytag_escrow.wasm
Wasm Size:  415 bytes (optimize; ham hali 434 bytes)
Wasm Hash:  b34c5a165514737b2a598750553ea3cb5521e26554e8644fe098b3b8d4a35a9a
Exported:   ping
```

### Zincir üstü

| Adım | Değer |
|---|---|
| Wasm yükleme tx | [`df20beb0509a8658f4711bdfb0ad8b3431e2ee7036e86c661633cf61542ef640`](https://stellar.expert/explorer/testnet/tx/df20beb0509a8658f4711bdfb0ad8b3431e2ee7036e86c661633cf61542ef640) |
| Kontrat oluşturma tx | [`c5a03801aba998b3d925ab5f11142719839899875f026a2dd3ca21831883b61b`](https://stellar.expert/explorer/testnet/tx/c5a03801aba998b3d925ab5f11142719839899875f026a2dd3ca21831883b61b) |
| Contract ID | [`CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU`](https://stellar.expert/explorer/testnet/contract/CBJXVQGY24W2AXZ7XDY3BVGDADJRQ7PGEVL6SV2VMRYZMN64B5GLUUTU) |

**Doğrulama:** Zincire yüklenen wasm hash'i (`b34c5a16…`), yerel derleme
çıktısındaki hash ile birebir aynı. Deploy edilen kod ile derlenen kodun
aynı olduğunun kanıtı budur.

### Çağrı

```
$ stellar contract invoke --id paytag-escrow --source paytag-dev \
    --network testnet -- ping

ℹ️  Simulation identified as read-only. Send by rerunning with `--send=yes`.
"paytag"
```

`ping` durum değiştirmediği için stellar-cli çağrıyı salt okunur olarak
tanıyıp yalnızca simüle etti; zincire işlem gönderilmedi ve ücret oluşmadı.

**Sonuç: Faz 0.4 ✅** — Rust → wasm → deploy → invoke zinciri çalışıyor.

---

## Faz 2 — Escrow kontratı

_(deposit / claim / refund işlemleri buraya)_

## Faz 3 — Uçtan uca doğrulama

_(OAuth → verifier imzası → claim işlemi buraya)_
