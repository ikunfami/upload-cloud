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
  const result = { provider: '', providers: {} };
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
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"(.*)"\s*$/);
      if (!m || !section) continue;
      if (section === 'cloud' && m[1] === 'provider') {
        result.provider = m[2];
        continue;
      }
      const keyMap = PROVIDER_KEY_MAPS[section];
      if (!keyMap) continue;
      const envKey = keyMap[m[1]];
      if (envKey) {
        if (!result.providers[section]) result.providers[section] = {};
        result.providers[section][envKey] = m[2];
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

  return {
    provider,
    creds,
    prefix: get('prefix'),
    publicUrl: get('public_url'),
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

function formatLocalDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function writeUploadLog(results) {
  const dir = getLogDir();
  await fs.mkdir(dir, { recursive: true });
  const logPath = path.join(dir, `${formatLocalDate(new Date())}-upload-log.json`);

  let log = { success: [], error: [] };
  if (existsSync(logPath)) {
    try {
      const parsed = JSON.parse(await fs.readFile(logPath, 'utf8'));
      if (Array.isArray(parsed)) {
        // migrate old flat-array format
        for (const r of parsed) {
          (r && r.status === 'failed' ? log.error : log.success).push(r);
        }
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.success)) log.success = parsed.success;
        if (Array.isArray(parsed.error)) log.error = parsed.error;
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
    (r.success ? log.success : log.error).push(entry);
  }

  await fs.writeFile(logPath, JSON.stringify(log, null, 2), 'utf8');
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
      results.push(await uploadOne(target, config, file, args));
    } catch (err) {
      results.push({ success: false, provider: config.provider, file, error: err.message });
    }
  }
  console.log(JSON.stringify(results, null, 2));
  const logResults = results.filter((r) => !r.dryRun);
  if (logResults.length) {
    try {
      const logPath = await writeUploadLog(logResults);
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
