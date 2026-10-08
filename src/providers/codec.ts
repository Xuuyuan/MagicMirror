import { z } from 'zod';
import { ProviderError } from '../domain/models';

/**
 * 各 Provider 共用的编解码、公钥加密与响应解析工具。
 *
 * Hermes 上没有 Node Buffer 与浏览器 btoa/atob，而每个平台的协议都依赖同一套
 * Base64 / UTF-8 / RSA-PKCS#1 v1.5 原语；集中在此，避免每个 Provider 复制实现。
 */

export function utf8ToBytes(value: string): Uint8Array {
  // 手写 UTF-8 编码：不依赖 TextEncoder / Buffer（Hermes 上不一定存在）。
  const bytes: number[] = [];
  for (const char of value) {
    const point = char.codePointAt(0) ?? 0;
    if (point < 0x80) bytes.push(point);
    else if (point < 0x800) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 63));
    else if (point < 0x10000) {
      bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 63), 0x80 | (point & 63));
    } else {
      bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 63),
        0x80 | ((point >> 6) & 63), 0x80 | (point & 63));
    }
  }
  return new Uint8Array(bytes);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  let value = '';
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i];
    let point: number;
    if (first < 0x80) { point = first; i += 1; } else if ((first & 0xe0) === 0xc0) {
      point = ((first & 31) << 6) | (bytes[i + 1] & 63); i += 2;
    } else if ((first & 0xf0) === 0xe0) {
      point = ((first & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63); i += 3;
    } else {
      point = ((first & 7) << 18) | ((bytes[i + 1] & 63) << 12)
        | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); i += 4;
    }
    value += String.fromCodePoint(point);
  }
  return value;
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
// 预先建好的反查表：解码时避免对每个字符做 O(64) 的 indexOf 扫描。
const reverseAlphabet = new Int8Array(128).fill(-1);
for (let index = 0; index < alphabet.length; index += 1) reverseAlphabet[alphabet.charCodeAt(index)] = index;

export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]; const b = bytes[i + 1] ?? 0; const c = bytes[i + 2] ?? 0;
    result += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)]
      + (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=')
      + (i + 2 < bytes.length ? alphabet[c & 63] : '=');
  }
  return result;
}

export function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0; let bits = 0; let index = 0;
  for (const char of clean) {
    acc = (acc << 6) | reverseAlphabet[char.charCodeAt(0)];
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes[index++] = (acc >> bits) & 0xff; }
  }
  return bytes.subarray(0, index);
}

/** 保守解析平台返回的分数字符串：只接受普通的非负十进制数，其余一律视为缺失。 */
export function numericScore(value: string | undefined): number | undefined {
  if (value === undefined || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseValidated<T>(schema: z.ZodType<T>, raw: unknown, message: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new ProviderError('UNKNOWN', message);
  return result.data;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i -= 1) { bytes[i] = Number(value & 0xffn); value >>= 8n; }
  return bytes;
}

export function modPow(value: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n; let base = value % modulus; let power = exponent;
  while (power > 0n) { if (power & 1n) result = (result * base) % modulus; base = (base * base) % modulus; power >>= 1n; }
  return result;
}

/**
 * RSA（EME-PKCS1-v1_5 + RSAEP），仅使用公开参数与公开输入。
 * 不引入 node-forge：各平台只需要规格明确的公钥运算，且其内置随机源在 RN 上不可靠。
 * `random` 须返回非全零随机字节；实现会丢弃其中的 0 字节以满足 PKCS#1 填充要求。
 */
export function rsaEncryptPkcs1(message: Uint8Array, modulus: bigint, exponent: bigint, random: (size: number) => Uint8Array): Uint8Array {
  const size = (modulus.toString(2).length + 7) >> 3;
  const padding = new Uint8Array(size - message.length - 3);
  if (padding.length < 8) throw new ProviderError('UNKNOWN', '加密载荷过长');
  for (let filled = 0; filled < padding.length;) {
    for (const byte of random(padding.length - filled + 8)) {
      if (filled >= padding.length) break;
      if (byte !== 0) { padding[filled] = byte; filled += 1; }
    }
  }
  const block = new Uint8Array(size);
  block[0] = 0; block[1] = 2; block.set(padding, 2);
  block[size - message.length - 1] = 0; block.set(message, size - message.length);
  return bigIntToBytes(modPow(bytesToBigInt(block) % modulus, exponent, modulus), size);
}
