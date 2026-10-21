---
name: upload-cloud
author: ikunfami
description: "Upload any local file (images, documents, archives, etc.) to cloud storage or image hosts — Aliyun OSS, Tencent COS, SM.MS, GitHub, Qiniu, Imgur, Upyun. The user says where to upload; if not specified, a configurable default provider (config, default Aliyun) is used. Supports image compression, batch uploads, and returns public URLs. 将本地任意文件上传到阿里云 OSS / 腾讯云 COS / SM.MS / GitHub / 七牛云 / Imgur / 又拍云，支持图片压缩、批量上传、返回公共 URL。"
---

# Upload Files to Cloud Storage (OSS / COS / SM.MS / GitHub / Qiniu / Imgur / Upyun)

## When to Use
Use this skill when the user asks to upload local images, documents, archives, or any other files to cloud storage or an image host — e.g. "upload file to OSS" / "上传到阿里云" / "上传到腾讯云 COS" / "传到 SM.MS" / "传图床" / "put this file on COS".

## Supported Providers

| Provider | Aliases | Needs config |
|---|---|---|
| Aliyun OSS | `aliyun`, `oss`, `alibaba`, `阿里云` | access_key_id, access_key_secret, bucket, endpoint |
| Tencent COS | `tencent`, `cos`, `qcloud`, `腾讯云` | secret_id, secret_key, bucket, region |
| SM.MS | `smms`, `sm.ms` | token |
| GitHub | `github`, `gh` | token (repo scope), owner, repo |
| Qiniu | `qiniu`, `七牛云` | access_key, secret_key, bucket, domain |
| Imgur | `imgur` | client_id |
| Upyun 又拍云 | `upyun`, `又拍云` | bucket, operator, password, domain |

SM.MS / GitHub / Qiniu / Imgur / Upyun are implemented with plain HTTP (no SDK), so no extra dependencies are needed.

## Choosing the Provider
Provider is resolved in this priority order:

1. **What the user said**: map their wording to a provider using the alias table above. Pass it to the script with `--provider`.
2. **Environment variable** `CLOUD_PROVIDER`.
3. **Config default**: the `provider` key in the `[skills.cloud]` table (default `aliyun`).

If the user does not say where to upload, use the configured default (Aliyun unless changed).

## Required Configuration
Configuration is read from (in priority order — environment variables win):

1. Environment variables (`CLOUD_PROVIDER`, plus the per-provider variables listed below), or
2. A `config.toml` placed next to `upload.js` (copy `config.toml.example` to get started), or
3. The `[skills.cloud]` tables in `~/.kimi-code/config.toml` (the agent exports them as environment variables before running the script).

```toml
[skills.cloud]
provider = "aliyun"   # Default provider when the user does not specify one
dedup = false         # true = skip re-uploading a file whose local path already has a successful record in the upload logs
log_keep_days = 7     # How many daily log files to keep; oldest files beyond this are deleted on each upload

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

[skills.cloud.smms]
token = ""   # Required; from https://sm.ms/home/apitoken (the API rejects anonymous uploads)

[skills.cloud.github]
token = ""        # https://github.com/settings/tokens — repo scope
owner = ""        # GitHub user/org
repo = ""         # repository
branch = "main"
prefix = "uploads"
public_url = ""   # Optional; e.g. jsDelivr https://cdn.jsdelivr.net/gh/owner/repo@branch

[skills.cloud.qiniu]
access_key = ""
secret_key = ""
bucket = ""
domain = ""       # Required: bound CDN/test domain, e.g. http://xxx.bkt.clouddn.com
prefix = "uploads"
default_quality = 80

[skills.cloud.imgur]
client_id = ""    # https://api.imgur.com/oauth2/addclient

[skills.cloud.upyun]
bucket = ""
operator = ""
password = ""
domain = ""       # Required: bound domain, e.g. https://xxx.b0.upaiyun.com
prefix = "uploads"
default_quality = 80
```

Only the table for the chosen provider needs to be filled. If that table does not exist or any required field is empty, prompt the user to fill in real credentials first (and tell them where to get them — see the per-provider links above). Never commit `config.toml` with real credentials.

Environment variable names follow the config keys: `CLOUD_PROVIDER`, `CLOUD_DEDUP` (`true` / `false`), `CLOUD_LOG_KEEP_DAYS` (integer), `OSS_ACCESS_KEY_ID`, `COS_SECRET_ID`, `SMMS_TOKEN`, `GITHUB_TOKEN` / `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH`, `QINIU_ACCESS_KEY` / `QINIU_DOMAIN`, `IMGUR_CLIENT_ID`, `UPYUN_BUCKET` / `UPYUN_OPERATOR` / `UPYUN_PASSWORD` / `UPYUN_DOMAIN`, etc.

## Workflow
1. **Determine the provider** from the user's request using the alias table; if unspecified, use the `provider` default from the config.
2. **Read config**: if a `config.toml` exists next to `upload.js`, `upload.js` reads the `[skills.cloud]` tables from it automatically. Otherwise, parse `~/.kimi-code/config.toml` with Python's built-in `tomllib`, extract the `[skills.cloud]` / `[skills.cloud.<provider>]` tables, and export them as environment variables (`CLOUD_PROVIDER`, `OSS_ACCESS_KEY_ID`, ..., `COS_SECRET_ID`, ..., etc.).
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
5. **Return the result**: parse the JSON the script prints and report the upload URL of each file to the user (each result includes a `provider` field); if any file fails, report the specific error. When dedup is on and a file was already uploaded, the result has `"deduped": true` — report the existing URL and note that no re-upload happened.

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

## Provider-specific Notes
- **SM.MS**: URL is allocated by the service at upload time (cannot be predicted in `--dry-run`, where `url` is `null`). SM.MS may reject/replace duplicate content. Anonymous uploads have rate limits; bind a token for higher limits.
- **GitHub**: the file lands in the repo at `{prefix}/{timestamp}.{ext}`; the returned URL is the raw.githubusercontent.com link unless `public_url` (e.g. a jsDelivr CDN URL) is set. Re-uploading the same key overwrites the file (a new commit).
- **Qiniu**: `domain` is required — the upload token and form upload are computed in-script (HMAC-SHA1), no SDK needed.
- **Imgur**: the returned link is whatever Imgur allocates; anonymous client-id uploads are subject to their rate limits.
- **Upyun**: uses the REST API with Basic auth (operator + password); `domain` is required.
- All HTTP-based providers (SM.MS / GitHub / Qiniu / Imgur / Upyun) use Node's built-in `fetch` — no extra npm dependencies.

## Upload Log
- Every real upload (success or failure) is appended to a daily log file: `%APPDATA%\upload-cloud\YYYY-MM-DD-upload-log.json` on Windows (`~/.config/upload-cloud/` elsewhere). The directory is created automatically if missing.
- The log file is a JSON object with two categories, each holding a `total` count and a `list` of records:

```json
{
  "success": {
    "total": 1,
    "list": [
      { "time": "...", "localPath": "...", "url": "...", "key": "...", "provider": "...", "size": 12345, "originalSize": 23456, "type": "image/png" }
    ]
  },
  "error": {
    "total": 1,
    "list": [
      { "time": "...", "localPath": "...", "url": null, "key": null, "provider": "...", "size": null, "originalSize": 23456, "type": "image/png", "error": "..." }
    ]
  }
}
```

- Each record contains: `time` (ISO), `localPath` (local file path), `url` (returned public URL, `null` in `error`), `key` (object key), `provider`, `size` (uploaded bytes), `originalSize` (local file bytes), `type` (MIME type), and `error` (only in `error` entries).
- `--dry-run` uploads are not logged. A log-write failure does not affect the upload result or exit code.
- **Retention**: after each logged upload, only the most recent `log_keep_days` daily log files (default **7**) are kept — the oldest files beyond that are deleted automatically.

## Deduplication
- When `dedup = true` in the `[skills.cloud]` table (or `CLOUD_DEDUP=true`), the script searches all daily log files before uploading: if the **local file path** already has a successful record, the upload is skipped and the existing URL is returned instead (the result carries `"deduped": true` and `firstUploadedAt`).
- Matching is by resolved local path (case-insensitive on Windows) and success entries only; failed uploads never block a retry. Deduped hits are not written to the log again.
- When `dedup` is disabled (default), files are uploaded directly without any log lookup.

## Notes
- **Any file**: non-image files are uploaded as-is, ignoring `--max-width` / `--max-height` / `--quality` / `--max-size`.- **Compress by default**: images are compressed with `default_quality` (default 80) unless `--no-compress` is passed.
- **Compression failure**: automatically falls back to the original image so the upload never breaks.
- **Security**: never upload sensitive files such as `.env`, SSH private keys, or password files.
- **Batch**: `--file` can be passed multiple times; any failure makes the script exit with a non-zero code.
- **Testing**: use `--dry-run` to inspect the provider, generated key, URL, and compressed size without calling the service.

## Helper Script Source

### package.json
```json
{
  "name": "upload-cloud-helper",
  "version": "1.1.0",
  "description": "Helper script for uploading files to Aliyun OSS, Tencent COS, SM.MS, GitHub, Qiniu, Imgur or Upyun",
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
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
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
  阿里云: 'aliyun',
  tencent: 'tencent',
  tencentcloud: 'tencent',
  cos: 'tencent',
  qcloud: 'tencent',
  腾讯云: 'tencent',
  smms: 'smms',
  'sm.ms': 'smms',
  sm: 'smms',
  github: 'github',
  gh: 'github',
  qiniu: 'qiniu',
  qiniuyun: 'qiniu',
  七牛: 'qiniu',
  七牛云: 'qiniu',
  imgur: 'imgur',
  upyun: 'upyun',
  又拍云: 'upyun',
  又拍: 'upyun',
};

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
  smms: {
    token: 'SMMS_TOKEN',
  },
  github: {
    token: 'GITHUB_TOKEN',
    owner: 'GITHUB_OWNER',
    repo: 'GITHUB_REPO',
    branch: 'GITHUB_BRANCH',
    prefix: 'GITHUB_PREFIX',
    public_url: 'GITHUB_PUBLIC_URL',
  },
  qiniu: {
    access_key: 'QINIU_ACCESS_KEY',
    secret_key: 'QINIU_SECRET_KEY',
    bucket: 'QINIU_BUCKET',
    domain: 'QINIU_DOMAIN',
    prefix: 'QINIU_PREFIX',
    default_quality: 'QINIU_DEFAULT_QUALITY',
  },
  imgur: {
    client_id: 'IMGUR_CLIENT_ID',
  },
  upyun: {
    bucket: 'UPYUN_BUCKET',
    operator: 'UPYUN_OPERATOR',
    password: 'UPYUN_PASSWORD',
    domain: 'UPYUN_DOMAIN',
    prefix: 'UPYUN_PREFIX',
    default_quality: 'UPYUN_DEFAULT_QUALITY',
  },
};

const PROVIDER_REQUIRED = {
  aliyun: ['access_key_id', 'access_key_secret', 'bucket', 'endpoint'],
  tencent: ['secret_id', 'secret_key', 'bucket', 'region'],
  smms: ['token'],
  github: ['token', 'owner', 'repo'],
  qiniu: ['access_key', 'secret_key', 'bucket', 'domain'],
  imgur: ['client_id'],
  upyun: ['bucket', 'operator', 'password', 'domain'],
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

function readLocalConfig() {
  const result = { provider: '', dedup: false, providers: {} };
  try {
    const configPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.toml');
    const text = readFileSync(configPath, 'utf8');
    let section = null; // 'cloud' | provider name
    for (const line of text.split('\n')) {
      const sec = line.match(/^\s*\[skills\.cloud(?:\.([A-Za-z0-9_.-]+))?\]\s*$/);
      if (sec) {
        section = sec[1] || 'cloud';
        continue;
      }
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(?:"([^"]*)"|(true|false)|(\d+))\s*$/i);
      if (!m || !section) continue;
      const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3].toLowerCase() : m[4];
      if (section === 'cloud') {
        if (m[1] === 'provider') result.provider = value;
        else if (m[1] === 'dedup') result.dedup = value === 'true';
        else if (m[1] === 'log_keep_days') result.logKeepDays = parseInt(value, 10);
        continue;
      }
      const keyMap = PROVIDER_KEY_MAPS[section];
      if (!keyMap) continue;
      const envKey = keyMap[m[1]];
      if (envKey) {
        if (!result.providers[section]) result.providers[section] = {};
        result.providers[section][envKey] = value;
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
  const localProvider = local.providers[provider] || {};
  const get = (configKey) => process.env[keyMap[configKey]] || localProvider[keyMap[configKey]] || '';

  const missing = PROVIDER_REQUIRED[provider].filter((k) => !get(k));
  if (missing.length) {
    throw new Error(
      `Missing ${provider} configuration: ${missing.join(', ')} (set env vars or a [skills.cloud.${provider}] table in config.toml next to upload.js, or pass --provider <another>)`
    );
  }

  const creds = {};
  for (const configKey of Object.keys(keyMap)) {
    creds[configKey] = get(configKey);
  }
  if (provider === 'github' && !creds.branch) {
    creds.branch = 'main';
  }
  if (provider === 'aliyun') {
    creds.secure = true;
    if (creds.endpoint.startsWith('https://')) {
      creds.endpoint = creds.endpoint.slice(8);
    } else if (creds.endpoint.startsWith('http://')) {
      creds.endpoint = creds.endpoint.slice(7);
      creds.secure = false;
    }
  }

  const rawQuality = get('default_quality');
  const parsedQuality = rawQuality ? parseInt(rawQuality, 10) : NaN;

  const envDedup = (process.env.CLOUD_DEDUP || '').toLowerCase();
  const envKeepDays = parseInt(process.env.CLOUD_LOG_KEEP_DAYS || '', 10);
  const keepDays = Number.isNaN(envKeepDays) ? local.logKeepDays : envKeepDays;

  return {
    provider,
    creds,
    prefix: get('prefix'),
    publicUrl: get('public_url'),
    defaultQuality: Number.isNaN(parsedQuality) ? 80 : parsedQuality,
    dedup: envDedup ? envDedup === 'true' : local.dedup === true,
    logKeepDays: Number.isInteger(keepDays) && keepDays >= 1 ? keepDays : 7,
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
  const c = config.creds;
  const base = config.publicUrl ? config.publicUrl.replace(/\/+$/, '') : null;
  switch (config.provider) {
    case 'aliyun':
      return base ? `${base}/${key}` : `https://${c.bucket}.${c.endpoint}/${key}`;
    case 'tencent':
      return base ? `${base}/${key}` : `https://${c.bucket}.cos.${c.region}.myqcloud.com/${key}`;
    case 'github':
      // Without a public_url the raw URL is only known after the API responds
      return base ? `${base}/${key}` : null;
    case 'qiniu':
    case 'upyun':
      return c.domain ? `${c.domain.replace(/\/+$/, '')}/${key}` : null;
    default:
      // smms / imgur: the URL is allocated by the service at upload time
      return null;
  }
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
    const c = config.creds;
    return {
      kind: 'oss',
      client: new OSS({
        endpoint: c.endpoint,
        accessKeyId: c.access_key_id,
        accessKeySecret: c.access_key_secret,
        bucket: c.bucket,
        secure: c.secure,
        timeout: 120000,
      }),
    };
  }
  if (config.provider === 'tencent') {
    const c = config.creds;
    return {
      kind: 'cos',
      client: new COS({
        SecretId: c.secret_id,
        SecretKey: c.secret_key,
        FileParallelLimit: 3,
        Timeout: 120000,
      }),
    };
  }
  // smms / github / qiniu / imgur / upyun: plain fetch, no SDK client needed
  return { kind: config.provider };
}

async function fetchJson(url, options, label) {
  const res = await fetch(url, options);
  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    throw new Error(`${label} failed: HTTP ${res.status} ${(json && (json.message || json.error)) || ''}`.trim());
  }
  return json;
}

async function putObject(target, config, key, buffer, mimeType, fileName) {
  const c = config.creds;

  if (target.kind === 'oss') {
    const result = await target.client.put(key, buffer, { mime: mimeType });
    return { url: null, etag: result.etag };
  }

  if (target.kind === 'cos') {
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
    return { url: null, etag: data.ETag };
  }

  if (target.kind === 'smms') {
    const form = new FormData();
    form.append('smfile', new Blob([buffer], { type: mimeType }), fileName);
    const headers = {};
    if (c.token) headers.Authorization = c.token;
    const json = await fetchJson('https://sm.ms/api/v2/upload', { method: 'POST', headers, body: form }, 'SM.MS upload');
    // image_repeated still returns the existing URL
    if (json && json.data && json.data.url) {
      return { url: json.data.url, deleteUrl: json.data.delete };
    }
    throw new Error(`SM.MS upload failed: ${(json && json.message) || 'unknown error'}`);
  }

  if (target.kind === 'github') {
    const api = `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${encodeURI(key)}`;
    const json = await fetchJson(
      api,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${c.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'upload-cloud-skill',
        },
        body: JSON.stringify({ message: `upload ${key}`, content: buffer.toString('base64'), branch: c.branch }),
      },
      'GitHub API'
    );
    return { url: json && json.content ? json.content.download_url : null };
  }

  if (target.kind === 'qiniu') {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const scope = `${c.bucket}:${key}`;
    const encodedPolicy = Buffer.from(JSON.stringify({ scope, deadline })).toString('base64url');
    const encodedSign = crypto.createHmac('sha1', c.secret_key).update(encodedPolicy).digest('base64url');
    const uploadToken = `${c.access_key}:${encodedSign}:${encodedPolicy}`;
    const form = new FormData();
    form.append('token', uploadToken);
    form.append('key', key);
    form.append('file', new Blob([buffer], { type: mimeType }), fileName);
    const json = await fetchJson('https://upload.qiniup.com', { method: 'POST', body: form }, 'Qiniu upload');
    if (json && json.error) {
      throw new Error(`Qiniu upload failed: ${json.error}`);
    }
    return { url: `${c.domain.replace(/\/+$/, '')}/${key}` };
  }

  if (target.kind === 'imgur') {
    const form = new FormData();
    form.append('image', new Blob([buffer], { type: mimeType }), fileName);
    const json = await fetchJson(
      'https://api.imgur.com/3/upload',
      { method: 'POST', headers: { Authorization: `Client-ID ${c.client_id}` }, body: form },
      'Imgur upload'
    );
    if (json && json.success && json.data && json.data.link) {
      return { url: json.data.link };
    }
    throw new Error(`Imgur upload failed: ${(json && json.data && json.data.error) || 'unknown error'}`);
  }

  if (target.kind === 'upyun') {
    const auth = Buffer.from(`${c.operator}:${c.password}`).toString('base64');
    const res = await fetch(`https://v0.api.upyun.com/${c.bucket}/${key}`, {
      method: 'PUT',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': mimeType },
      body: buffer,
    });
    if (!res.ok) {
      throw new Error(`Upyun upload failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`.trim());
    }
    return { url: `${c.domain.replace(/\/+$/, '')}/${key}` };
  }

  throw new Error(`Unknown provider: ${target.kind}`);
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
  const fileName = path.basename(filePath);
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
  const result = await putObject(target, config, key, buffer, finalMime, fileName);
  return {
    success: true,
    provider: config.provider,
    file: filePath,
    key,
    url: result.url || makePublicUrl(config, key),
    etag: result.etag,
    originalSize: originalBuffer.length,
    size: buffer.length,
    mime: finalMime,
  };
}

function getLogDir() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'upload-cloud');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'upload-cloud');
}

function* iterLogEntries(parsed) {
  if (Array.isArray(parsed)) {
    yield* parsed; // v0 flat-array format
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  for (const cat of ['success', 'error']) {
    const bucket = parsed[cat];
    if (Array.isArray(bucket)) yield* bucket; // v1: bare array
    else if (bucket && Array.isArray(bucket.list)) yield* bucket.list; // v2: { total, list }
  }
}

async function findUploadedByPath(filePath) {
  const dir = getLogDir();
  let files = [];
  try {
    files = (await fs.readdir(dir))
      .filter((f) => /^\d{4}-\d{2}-\d{2}-upload-log\.json$/.test(f))
      .sort()
      .reverse(); // newest day first
  } catch {
    return null; // no log dir yet
  }
  const norm = (p) => {
    const s = String(p).replace(/\\/g, '/');
    return process.platform === 'win32' ? s.toLowerCase() : s;
  };
  const target = norm(path.resolve(filePath));
  for (const f of files) {
    let parsed = null;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
    } catch {
      continue; // skip unreadable log file
    }
    for (const entry of iterLogEntries(parsed)) {
      if (entry && entry.url && norm(entry.localPath) === target) {
        return entry;
      }
    }
  }
  return null;
}

function formatLocalDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function pruneOldLogs(keepDays) {
  const dir = getLogDir();
  let files = [];
  try {
    files = (await fs.readdir(dir))
      .filter((f) => /^\d{4}-\d{2}-\d{2}-upload-log\.json$/.test(f))
      .sort(); // oldest first
  } catch {
    return;
  }
  const excess = files.length - keepDays;
  for (let i = 0; i < excess; i++) {
    await fs.unlink(path.join(dir, files[i]));
    console.error(`Log retention: removed ${files[i]} (keeping last ${keepDays} days)`);
  }
}

async function writeUploadLog(results, keepDays) {
  const dir = getLogDir();
  await fs.mkdir(dir, { recursive: true });
  const logPath = path.join(dir, `${formatLocalDate(new Date())}-upload-log.json`);

  const emptyLog = () => ({ total: 0, list: [] });
  let log = { success: emptyLog(), error: emptyLog() };
  if (existsSync(logPath)) {
    try {
      const parsed = JSON.parse(await fs.readFile(logPath, 'utf8'));
      const takeList = (bucket) => {
        if (Array.isArray(bucket)) return bucket; // v1: bare array
        if (bucket && Array.isArray(bucket.list)) return bucket.list; // v2: { total, list }
        return null;
      };
      if (Array.isArray(parsed)) {
        // migrate v0 flat-array format
        for (const r of parsed) {
          ((r && r.status === 'failed' ? log.error : log.success).list).push(r);
        }
      } else if (parsed && typeof parsed === 'object') {
        for (const cat of ['success', 'error']) {
          const list = takeList(parsed[cat]);
          if (list) log[cat].list = list;
        }
      }
    } catch {
      // corrupted log file: start fresh
    }
  }

  const now = new Date();
  for (const r of results) {
    const entry = {
      time: now.toISOString(),
      localPath: r.file,
      url: r.success ? r.url || null : null,
      key: r.key || null,
      provider: r.provider,
      size: typeof r.size === 'number' ? r.size : null,
      originalSize: typeof r.originalSize === 'number' ? r.originalSize : null,
      type: r.mime || mime.lookup(r.file) || 'application/octet-stream',
    };
    if (!r.success) {
      entry.error = r.error || 'unknown error';
      try {
        entry.originalSize = (await fs.stat(r.file)).size;
      } catch {
        // file unreadable: keep null
      }
    }
    (r.success ? log.success : log.error).list.push(entry);
  }

  log.success.total = log.success.list.length;
  log.error.total = log.error.list.length;
  await fs.writeFile(logPath, JSON.stringify(log, null, 2), 'utf8');
  await pruneOldLogs(keepDays);
  return logPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'Usage: upload.js --file <path> [--file <path> ...] [--provider aliyun|tencent|smms|github|qiniu|imgur|upyun] [--prefix <dir>] [--max-width <px>] [--max-height <px>] [--quality <0-100>] [--no-compress] [--max-size <KB>] [--key <name>] [--dry-run]'
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
      if (config.dedup && !args.dryRun) {
        const hit = await findUploadedByPath(file);
        if (hit) {
          console.error(`Already uploaded (dedup, skipped): ${file} -> ${hit.url}`);
          results.push({
            success: true,
            provider: config.provider,
            file,
            key: hit.key || null,
            url: hit.url,
            size: typeof hit.size === 'number' ? hit.size : null,
            originalSize: typeof hit.originalSize === 'number' ? hit.originalSize : null,
            mime: hit.type || null,
            deduped: true,
            firstUploadedAt: hit.time || null,
          });
          continue;
        }
      }
      results.push(await uploadOne(target, config, file, args));
    } catch (err) {
      results.push({ success: false, provider: config.provider, file, error: err.message });
    }
  }
  console.log(JSON.stringify(results, null, 2));
  const logResults = results.filter((r) => !r.dryRun && !r.deduped);
  if (logResults.length) {
    try {
      const logPath = await writeUploadLog(logResults, config.logKeepDays);
      console.error(`Upload log written to ${logPath}`);
    } catch (err) {
      console.error(`Failed to write upload log: ${err.message}`);
    }
  }
  const failed = results.filter((r) => !r.success);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```
