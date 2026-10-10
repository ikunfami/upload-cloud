---
name: upload-cloud
author: ikunfami
description: "Upload any local file (images, documents, archives, etc.) to cloud storage — Aliyun OSS or Tencent Cloud COS. The user says where to upload (阿里云/OSS or 腾讯云/COS); if not specified, a configurable default provider (config, default Aliyun) is used. Supports image compression, batch uploads, and returns public URLs. 将本地任意文件上传到阿里云 OSS 或腾讯云 COS，支持图片压缩、批量上传、返回公共 URL。"
---

# Upload Files to Cloud Storage (Aliyun OSS / Tencent COS)

## When to Use
Use this skill when the user asks to upload local images, documents, archives, or any other files to cloud storage — e.g. "upload file to OSS" / "上传到阿里云" / "上传到腾讯云 COS" / "put this file on COS".

## Choosing the Provider
Provider is resolved in this priority order:

1. **What the user said**: 阿里云 / OSS / ali-oss → `aliyun`; 腾讯云 / COS / qcloud → `tencent`. Pass it to the script with `--provider`.
2. **Environment variable** `CLOUD_PROVIDER` (`aliyun` or `tencent`).
3. **Config default**: the `provider` key in the `[skills.cloud]` table (default `aliyun`).

If the user does not say where to upload, use the configured default (Aliyun unless changed).

## Required Configuration
Configuration is read from (in priority order — environment variables win):

1. Environment variables (`CLOUD_PROVIDER`, plus `OSS_*` for Aliyun or `COS_*` for Tencent), or
2. A `config.toml` placed next to `upload.js` (copy `config.toml.example` to get started), or
3. The `[skills.cloud]` tables in `~/.kimi-code/config.toml` (the agent exports them as environment variables before running the script).

```toml
[skills.cloud]
provider = "aliyun"   # Default provider when the user does not specify one: "aliyun" or "tencent"

[skills.cloud.aliyun]
access_key_id = "LTAI..."
access_key_secret = "..."
bucket = "my-bucket"
endpoint = "oss-cn-hangzhou.aliyuncs.com"
prefix = "uploads"
default_quality = 80   # Default image compression quality (1-100), default 80
public_url = ""   # Optional: custom CDN domain; empty means virtual-hosted style URL

[skills.cloud.tencent]
secret_id = "AKID..."
secret_key = "..."
bucket = "my-bucket-1234567890"   # COS bucket names carry the APPID suffix
region = "ap-guangzhou"
prefix = "uploads"
default_quality = 80
public_url = ""
```

Only the table for the chosen provider needs to be filled. If that table does not exist or any required field is empty, prompt the user to fill in real credentials first. Never commit `config.toml` with real credentials.

## Workflow
1. **Determine the provider** from the user's request; if unspecified, use the `provider` default from the config.
2. **Read config**: if a `config.toml` exists next to `upload.js`, `upload.js` reads the `[skills.cloud]` tables from it automatically. Otherwise, parse `~/.kimi-code/config.toml` with Python's built-in `tomllib`, extract the `[skills.cloud]` / `[skills.cloud.aliyun]` / `[skills.cloud.tencent]` tables, and export them as environment variables (`CLOUD_PROVIDER`, `OSS_ACCESS_KEY_ID`, ..., `COS_SECRET_ID`, ...).
3. **Prepare the helper script**: the helper script should live at `~/.kimi/skills/upload-cloud/upload.js`. If it does not exist, create the directory and write the `package.json` and `upload.js` from the "Helper Script Source" section below into that directory, then run `npm install`.
4. **Run the upload**: build the command according to the user's needs. Example:
   ```bash
   node "~/.kimi/skills/upload-cloud/upload.js" \
     --file "<local_path>" \
     [--file "<local_path_2>"] \
     [--provider tencent] \
     [--prefix "images/2025"] \
     [--max-width 1920] \
     [--max-height 1920] \
     [--quality 80] \
     [--no-compress] \
     [--max-size 500] \
     [--dry-run]
   ```
5. **Return the result**: parse the JSON the script prints and report the upload URL of each file to the user (each result includes a `provider` field); if any file fails, report the specific error.

## Image Compression Rules (same strategy as upload-oss / upload-cos)
- **Compress by default**: when uploading an image, if `--quality` is not explicitly given, automatically compress using `default_quality` from the config (default 80). Pass `--no-compress` to skip compression and upload the original.
- **No scaling by default**: scaling only happens when the user explicitly passes `--max-width` / `--max-height`, using **inside proportional scaling** (keep the aspect ratio; neither width nor height exceeds the limit).
- **Keep the original format** (auto): JPEG stays JPEG, PNG stays PNG — never force-convert the format.
- `--quality` only applies to JPEG / WEBP; PNG is saved as-is without quality adjustment.
- `--max-size <KB>` further lowers the quality to try to get the file under the given KB (dimensions unchanged).
- **Key fallback**: if the compressed file ends up **larger than or equal to the original**, the original file is uploaded instead.
- Non-image files ignore all compression parameters and are uploaded as-is.

## Naming Rules
- Object key format: `{prefix}/{yyyyMMddHHmmssSSS}.{ext}` (17-digit timestamp with milliseconds; the original filename is not kept)
- If the user specifies `--prefix`, it overrides the default `prefix` from the provider's config table.
- The millisecond timestamp basically avoids overwrites; for stronger uniqueness, an extra random code can be appended.

## Notes
- **Any file**: non-image files are uploaded as-is, ignoring `--max-width` / `--max-height` / `--quality` / `--max-size`.
- **Compress by default**: images are compressed with `default_quality` (default 80) unless `--no-compress` is passed.
- **Compression failure**: automatically falls back to the original image so the upload never breaks.
- **Security**: never upload sensitive files such as `.env`, SSH private keys, or password files.
- **Batch**: `--file` can be passed multiple times; any failure makes the script exit with a non-zero code.
- **Testing**: use `--dry-run` to inspect the provider, generated key, URL, and compressed size without calling the cloud.

## Helper Script Source

### package.json
```json
{
  "name": "upload-cloud-helper",
  "version": "1.0.0",
  "description": "Helper script for uploading files to Aliyun OSS or Tencent Cloud COS",
  "type": "module",
  "private": true,
  "bin": {
    "upload-cloud": "./upload.js"
  },
  "dependencies": {
    "ali-oss": "^6.22.0",
    "cos-nodejs-sdk-v5": "^2.14.0",
    "jimp": "^0.22.12",
    "mime-types": "^2.1.35"
  }
}
```

### upload.js
```js
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
```
