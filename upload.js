#!/usr/bin/env node
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mime from 'mime-types';
import OSS from 'ali-oss';
import COS from 'cos-nodejs-sdk-v5';

let Jimp;
try {
  const jimpMod = await import('jimp');
  Jimp = jimpMod.default || jimpMod.Jimp;
} catch {
  // jimp is optional; image compression will be skipped if not available
}

const PROVIDER_ALIASES = {
  aliyun: 'aliyun',
  ali: 'aliyun',
  oss: 'aliyun',
  alibaba: 'aliyun',
  tencent: 'tencent',
  tencentcloud: 'tencent',
  cos: 'tencent',
  qcloud: 'tencent',
  阿里云: 'aliyun',
  腾讯云: 'tencent',
};

function normalizeProvider(raw) {
  if (!raw) return null;
  return PROVIDER_ALIASES[String(raw).trim().toLowerCase()] || null;
}

function parseArgs(argv) {
  const args = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' || a === '-f') {
      const v = argv[++i];
      if (v) args.files.push(v);
    } else if (a === '--provider') {
      args.provider = argv[++i];
    } else if (a === '--prefix') {
      args.prefix = argv[++i];
    } else if (a === '--max-width') {
      args.maxWidth = parseInt(argv[++i], 10);
    } else if (a === '--max-height') {
      args.maxHeight = parseInt(argv[++i], 10);
    } else if (a === '--quality') {
      args.quality = parseInt(argv[++i], 10);
    } else if (a === '--max-size') {
      args.maxSize = parseInt(argv[++i], 10);
    } else if (a === '--key') {
      args.key = argv[++i];
    } else if (a === '--no-compress') {
      args.noCompress = true;
    } else if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    }
  }
  return args;
}

const PROVIDER_KEY_MAPS = {
  aliyun: {
    access_key_id: 'OSS_ACCESS_KEY_ID',
    access_key_secret: 'OSS_ACCESS_KEY_SECRET',
    bucket: 'OSS_BUCKET',
    endpoint: 'OSS_ENDPOINT',
    prefix: 'OSS_PREFIX',
    public_url: 'OSS_PUBLIC_URL',
    default_quality: 'OSS_DEFAULT_QUALITY',
  },
  tencent: {
    secret_id: 'COS_SECRET_ID',
    secret_key: 'COS_SECRET_KEY',
    bucket: 'COS_BUCKET',
    region: 'COS_REGION',
    prefix: 'COS_PREFIX',
    public_url: 'COS_PUBLIC_URL',
    default_quality: 'COS_DEFAULT_QUALITY',
  },
};

function readLocalConfig() {
  const result = { provider: '', aliyun: {}, tencent: {} };
  try {
    const configPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.toml');
    const text = readFileSync(configPath, 'utf8');
    let section = null; // 'cloud' | 'aliyun' | 'tencent'
    for (const line of text.split('\n')) {
      const sec = line.match(/^\s*\[skills\.cloud(?:\.(aliyun|tencent))?\]\s*$/);
      if (sec) {
        section = sec[1] || 'cloud';
        continue;
      }
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"(.*)"\s*$/);
      if (!m || !section) continue;
      if (section === 'cloud' && m[1] === 'provider') {
        result.provider = m[2];
      } else if (section === 'aliyun' || section === 'tencent') {
        const envKey = PROVIDER_KEY_MAPS[section][m[1]];
        if (envKey) result[section][envKey] = m[2];
      }
    }
  } catch {
    // no local config.toml
  }
  return result;
}

function loadConfig(args) {
  const local = readLocalConfig();
  const provider =
    normalizeProvider(args.provider) ||
    normalizeProvider(process.env.CLOUD_PROVIDER) ||
    normalizeProvider(local.provider) ||
    'aliyun';

  const keyMap = PROVIDER_KEY_MAPS[provider];
  const localProvider = local[provider] || {};
  const env = (k) => process.env[k] || localProvider[k] || '';

  if (provider === 'aliyun') {
    const required = ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET', 'OSS_ENDPOINT'];
    const missing = required.filter((k) => !env(k));
    if (missing.length) {
      throw new Error(
        `Missing Aliyun OSS configuration: ${missing.join(', ')} (set env vars or a [skills.cloud.aliyun] table in config.toml next to upload.js, or pass --provider tencent)`
      );
    }
  } else {
    const required = ['COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET', 'COS_REGION'];
    const missing = required.filter((k) => !env(k));
    if (missing.length) {
      throw new Error(
        `Missing Tencent COS configuration: ${missing.join(', ')} (set env vars or a [skills.cloud.tencent] table in config.toml next to upload.js, or pass --provider aliyun)`
      );
    }
  }

  const shared = (k) => process.env[k] || localProvider[k] || '';
  let endpoint = '';
  let secure = true;
  if (provider === 'aliyun') {
    endpoint = env('OSS_ENDPOINT');
    if (endpoint.startsWith('https://')) {
      endpoint = endpoint.slice(8);
    } else if (endpoint.startsWith('http://')) {
      endpoint = endpoint.slice(7);
      secure = false;
    }
  }

  const rawQuality = shared(keyMap.default_quality);
  const parsedQuality = rawQuality ? parseInt(rawQuality, 10) : NaN;

  return {
    provider,
    aliyun:
      provider === 'aliyun'
        ? {
            accessKeyId: env('OSS_ACCESS_KEY_ID'),
            accessKeySecret: env('OSS_ACCESS_KEY_SECRET'),
            bucket: env('OSS_BUCKET'),
            endpoint,
            secure,
          }
        : null,
    tencent:
      provider === 'tencent'
        ? {
            secretId: env('COS_SECRET_ID'),
            secretKey: env('COS_SECRET_KEY'),
            bucket: env('COS_BUCKET'),
            region: env('COS_REGION'),
          }
        : null,
    prefix: shared(keyMap.prefix),
    publicUrl: shared(keyMap.public_url),
    defaultQuality: Number.isNaN(parsedQuality) ? 80 : parsedQuality,
  };
}

function generateKey(filePath, prefix) {
  const ext = path.extname(filePath).toLowerCase();
  const now = new Date();
  // yyyyMMddHHmmssSSS, 17 digits including milliseconds
  const ts = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 17);
  const name = `${ts}${ext}`;
  if (prefix) {
    const cleaned = prefix.replace(/\/+$/, '').replace(/\\/g, '/');
    return `${cleaned}/${name}`;
  }
  return name;
}

function makePublicUrl(config, key) {
  const base = config.publicUrl ? config.publicUrl.replace(/\/+$/, '') : null;
  if (config.provider === 'aliyun') {
    const c = config.aliyun;
    return base ? `${base}/${key}` : `https://${c.bucket}.${c.endpoint}/${key}`;
  }
  const c = config.tencent;
  return base ? `${base}/${key}` : `https://${c.bucket}.cos.${c.region}.myqcloud.com/${key}`;
}

async function renderImage(image, mimeType, quality) {
  const clone = image.clone();
  if (quality != null && typeof clone.quality === 'function') {
    clone.quality(quality);
  }
  return clone.getBufferAsync(mimeType);
}

async function compressImage(filePath, options) {
  if (!Jimp) return null;
  const { maxWidth, maxHeight, quality, maxSizeBytes } = options;
  const image = await Jimp.read(filePath);

  // 1. fit inside the box (max-width / max-height) while keeping aspect ratio
  const originalWidth = image.getWidth();
  const originalHeight = image.getHeight();
  let scale = 1;
  if (maxWidth && originalWidth > maxWidth) {
    scale = Math.min(scale, maxWidth / originalWidth);
  }
  if (maxHeight && originalHeight > maxHeight) {
    scale = Math.min(scale, maxHeight / originalHeight);
  }
  if (scale < 1) {
    image.resize(Math.round(originalWidth * scale), Math.round(originalHeight * scale));
  }

  // 2. keep original format (auto), fallback to JPEG if unknown
  const mimeType = mime.lookup(filePath) || 'image/jpeg';
  let bestBuffer = await renderImage(image, mimeType, quality);

  // 3. if a target file size is set, reduce quality only (no extra scaling)
  if (maxSizeBytes && bestBuffer.length > maxSizeBytes) {
    const floorQuality = 30;
    const startQuality = quality != null ? quality : 80;
    for (let q = startQuality - 10; q >= floorQuality; q -= 10) {
      const candidate = await renderImage(image, mimeType, q);
      if (candidate.length < bestBuffer.length) {
        bestBuffer = candidate;
      }
      if (bestBuffer.length <= maxSizeBytes) break;
    }
  }

  return { buffer: bestBuffer, mimeType };
}

function createClient(config) {
  if (config.provider === 'aliyun') {
    const c = config.aliyun;
    return {
      kind: 'oss',
      client: new OSS({
        endpoint: c.endpoint,
        accessKeyId: c.accessKeyId,
        accessKeySecret: c.accessKeySecret,
        bucket: c.bucket,
        secure: c.secure,
        timeout: 120000,
      }),
    };
  }
  const c = config.tencent;
  return {
    kind: 'cos',
    client: new COS({
      SecretId: c.secretId,
      SecretKey: c.secretKey,
      FileParallelLimit: 3,
      Timeout: 120000,
    }),
  };
}

async function putObject(target, config, key, buffer, mimeType) {
  if (target.kind === 'oss') {
    const result = await target.client.put(key, buffer, { mime: mimeType });
    return { etag: result.etag };
  }
  const c = config.tencent;
  const data = await new Promise((resolve, reject) => {
    target.client.putObject(
      { Bucket: c.bucket, Region: c.region, Key: key, Body: buffer, ContentType: mimeType },
      (err, result) => {
        if (err) {
          reject(new Error(err.error || err.message || JSON.stringify(err)));
        } else {
          resolve(result);
        }
      }
    );
  });
  return { etag: data.ETag };
}

async function uploadOne(target, config, filePath, args) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }
  const mimeType = mime.lookup(filePath) || 'application/octet-stream';
  const originalBuffer = await fs.readFile(filePath);
  let buffer = originalBuffer;
  let finalMime = mimeType;
  const isImage = mimeType.startsWith('image/');
  const effectiveQuality = args.quality != null ? args.quality : config.defaultQuality;
  const wantsCompress = !args.noCompress && (args.maxWidth || args.maxHeight || effectiveQuality != null || args.maxSize != null);

  if (isImage && wantsCompress && Jimp) {
    try {
      const compressed = await compressImage(filePath, {
        maxWidth: args.maxWidth,
        maxHeight: args.maxHeight,
        quality: effectiveQuality,
        maxSizeBytes: args.maxSize ? args.maxSize * 1024 : null,
      });
      if (compressed && compressed.buffer.length < originalBuffer.length) {
        buffer = compressed.buffer;
        finalMime = compressed.mimeType;
      } else {
        console.error(`Compression did not reduce size for ${filePath}, using original.`);
      }
    } catch (err) {
      console.error(`Compression failed for ${filePath}, using original: ${err.message}`);
    }
  }

  const key = args.key || generateKey(filePath, args.prefix != null ? args.prefix : config.prefix);
  if (args.dryRun) {
    return {
      success: true,
      provider: config.provider,
      file: filePath,
      key,
      url: makePublicUrl(config, key),
      originalSize: originalBuffer.length,
      size: buffer.length,
      mime: finalMime,
      dryRun: true,
    };
  }
  const result = await putObject(target, config, key, buffer, finalMime);
  return {
    success: true,
    provider: config.provider,
    file: filePath,
    key,
    url: makePublicUrl(config, key),
    etag: result.etag,
    originalSize: originalBuffer.length,
    size: buffer.length,
    mime: finalMime,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'Usage: upload.js --file <path> [--file <path> ...] [--provider aliyun|tencent] [--prefix <dir>] [--max-width <px>] [--max-height <px>] [--quality <0-100>] [--no-compress] [--max-size <KB>] [--key <name>] [--dry-run]'
    );
    process.exit(0);
  }
  if (!args.files.length) {
    throw new Error('No file specified. Use --file <path>.');
  }
  const config = loadConfig(args);
  const target = createClient(config);
  const results = [];
  for (const file of args.files) {
    try {
      results.push(await uploadOne(target, config, file, args));
    } catch (err) {
      results.push({ success: false, provider: config.provider, file, error: err.message });
    }
  }
  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.success);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
