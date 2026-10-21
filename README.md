# upload-cloud

一个 AI Agent Skill + 独立的 Node.js 脚本：把本地任意文件（图片、文档、压缩包等）上传到云存储或图床 —— **阿里云 OSS、腾讯云 COS、SM.MS、GitHub、七牛云、Imgur、又拍云**。用户说上传到哪里就上传到哪里；没说时用配置的默认服务商（默认阿里云）。

由 [upload-oss](../upload-oss) 和 [upload-cos](../upload-cos) 融合扩展而来，原有两个 skill 仍然保留。

## 功能特性

- 一个命令支持 7 个上传目标：阿里云 OSS（`ali-oss` SDK）、腾讯云 COS（`cos-nodejs-sdk-v5` SDK）、SM.MS、GitHub、七牛云、Imgur、又拍云（后 5 个用 Node 内置 `fetch` / `crypto` 实现，**零额外依赖**）
- 服务商自动识别：支持中英文别名，如 `oss` / `aliyun` / `阿里云`、`cos` / `tencent` / `腾讯云`、`七牛云`、`又拍云`、`sm.ms`、`gh`、`imgur`
- 配置默认值：用户没指定时回落到 `config.toml` 里的 `provider`（默认 `aliyun`）
- 支持任意文件类型，图片自动压缩（可配默认质量）、限制最大宽高、目标文件大小
- 批量上传（`--file` 可传多个），上传后输出 JSON 公共 URL
- 三种配置方式，按优先级：环境变量 > 脚本旁 `config.toml` > Agent 从 `~/.kimi-code/config.toml` 导出

## 快速开始

要求 Node.js 18+（内置 `fetch`）。

```bash
# 1. 安装依赖
npm install

# 2. 配置凭证（用哪个服务商就填哪个段）
cp config.toml.example config.toml

# 3. 上传
node upload.js --file ./test.png                      # 默认服务商（阿里云）
node upload.js --file ./test.png --provider tencent   # 腾讯云 COS
node upload.js --file ./test.png --provider smms      # SM.MS 图床
node upload.js --file ./test.png --provider github    # 传到 GitHub 仓库
node upload.js --file ./test.png --provider qiniu     # 七牛云
node upload.js --file ./test.png --provider imgur     # Imgur
node upload.js --file ./test.png --provider upyun     # 又拍云
```

## 支持的服务商

| 服务商 | 别名 | 必填配置 | 凭证获取 |
|--------|------|----------|----------|
| 阿里云 OSS | `aliyun` `oss` `alibaba` `阿里云` | access_key_id, access_key_secret, bucket, endpoint | 阿里云控制台 RAM |
| 腾讯云 COS | `tencent` `cos` `qcloud` `腾讯云` | secret_id, secret_key, bucket, region | 腾讯云控制台 CAM |
| SM.MS | `smms` `sm.ms` | token | [sm.ms/home/apitoken](https://sm.ms/home/apitoken) |
| GitHub | `github` `gh` | token(repo), owner, repo | [settings/tokens](https://github.com/settings/tokens) |
| 七牛云 | `qiniu` `七牛云` | access_key, secret_key, bucket, domain | 七牛控制台 |
| Imgur | `imgur` | client_id | [api.imgur.com](https://api.imgur.com/oauth2/addclient) |
| 又拍云 | `upyun` `又拍云` | bucket, operator, password, domain | 又拍云控制台 |

## 配置

```toml
[skills.cloud]
provider = "aliyun"   # 默认值：用户没说上传到哪里时用哪个

[skills.cloud.aliyun]
access_key_id = ""            # 必填
access_key_secret = ""        # 必填
bucket = ""                   # 必填
endpoint = "oss-cn-hangzhou.aliyuncs.com"  # 必填
prefix = "uploads"
public_url = ""
default_quality = 80

[skills.cloud.tencent]
secret_id = ""                # 必填
secret_key = ""               # 必填
bucket = "my-bucket-1234567890"  # 必填，COS bucket 带 APPID 后缀
region = "ap-guangzhou"       # 必填
prefix = "uploads"
public_url = ""
default_quality = 80

[skills.cloud.smms]
token = ""                    # 必填，https://sm.ms/home/apitoken 获取（API 已拒绝匿名上传）

[skills.cloud.github]
token = ""                    # 必填，需要 repo 权限
owner = ""                    # 必填，GitHub 用户名或组织
repo = ""                     # 必填，仓库名
branch = "main"
prefix = "uploads"
public_url = ""               # 可选，如 jsDelivr：https://cdn.jsdelivr.net/gh/owner/repo@branch

[skills.cloud.qiniu]
access_key = ""               # 必填
secret_key = ""               # 必填
bucket = ""                   # 必填
domain = ""                   # 必填，绑定的 CDN/测试域名，如 http://xxx.bkt.clouddn.com
prefix = "uploads"
default_quality = 80

[skills.cloud.imgur]
client_id = ""                # 必填

[skills.cloud.upyun]
bucket = ""                   # 必填
operator = ""                 # 必填，操作员名
password = ""                 # 必填，操作员密码
domain = ""                   # 必填，绑定的域名，如 https://xxx.b0.upaiyun.com
prefix = "uploads"
default_quality = 80
```

也可以用环境变量代替 `config.toml`：`CLOUD_PROVIDER` + 各服务商的变量（`OSS_*`、`COS_*`、`SMMS_TOKEN`、`GITHUB_TOKEN` / `GITHUB_OWNER` / `GITHUB_REPO`、`QINIU_*`、`IMGUR_CLIENT_ID`、`UPYUN_*`）。

> ⚠️ `config.toml` 包含真实凭证，已被 `.gitignore` 排除，不要提交到仓库。

## 服务商如何确定

按优先级逐级回落：

1. 用户指明（"上传到腾讯云"），脚本加 `--provider tencent`
2. 环境变量 `CLOUD_PROVIDER`
3. `config.toml` 的 `[skills.cloud]` 表里的 `provider`，**默认 `aliyun`**

## 命令行参数

```
node upload.js --file <path> [--file <path> ...]
  [--provider aliyun|tencent|smms|github|qiniu|imgur|upyun]  # 指定服务商
  [--prefix <dir>]             # 覆盖默认前缀
  [--max-width <px>]           # 图片最大宽度（等比缩放）
  [--max-height <px>]          # 图片最大高度
  [--quality <0-100>]          # 压缩质量，覆盖 default_quality
  [--no-compress]              # 不压缩，直接上传原图
  [--max-size <KB>]            # 目标文件大小，超了自动降质量
  [--key <name>]               # 自定义上传 key（默认时间戳命名）
  [--dry-run]                  # 只演练不上传
```

## 各服务商说明

- **SM.MS**：URL 由服务上传时分配，`--dry-run` 时 `url` 为 `null` 属正常；重复内容可能返回已有图片的 URL；token 必填（API 已拒绝匿名上传），在 [sm.ms/home/apitoken](https://sm.ms/home/apitoken) 获取
- **GitHub**：文件以 `{prefix}/{时间戳}.{ext}` 提交到仓库，返回 raw.githubusercontent.com 链接，配 `public_url` 可改走 jsDelivr 等 CDN；相同 key 重复上传会产生新 commit 覆盖
- **七牛云**：上传凭证（HMAC-SHA1）在脚本内现算，不需要 SDK；`domain` 必填
- **Imgur**：返回 Imgur 分配的链接；匿名 client_id 上传有限流
- **又拍云**：REST API + Basic 认证（操作员名 + 密码）；`domain` 必填

## 图片压缩规则

- **默认压缩**：图片默认按 `default_quality`（默认 80）压缩；`--no-compress` 上传原图
- **默认不缩放**：仅显式传 `--max-width` / `--max-height` 时等比缩放到框内
- **保持原格式**：JPEG 仍是 JPEG，PNG 仍是 PNG，不强制转格式
- **兜底**：压缩结果 ≥ 原图大小时自动回退上传原图，压缩失败也不影响上传

## 上传日志

每次真实上传（成功或失败）都会追加记录到当天的日志文件：

- **Windows**：`%APPDATA%\upload-cloud\YYYY-MM-DD-upload-log.json`（如 `C:\Users\xxx\AppData\Roaming\upload-cloud\2026-10-21-upload-log.json`）
- **其他系统**：`~/.config/upload-cloud/YYYY-MM-DD-upload-log.json`
- 目录不存在时自动创建；同一天多次上传追加到同一个文件
- 文件结构为 `{ "success": [...], "error": [...] }`，记录按成功/失败分别归入两个数组

每条记录字段：

| 字段 | 说明 |
|---|---|
| `time` | 记录时间（ISO 格式） |
| `localPath` | 本地文件路径 |
| `url` | 上传后返回的公共 URL（`error` 分类中为 `null`） |
| `key` | 云端对象 key |
| `provider` | 使用的服务商 |
| `size` | 实际上传字节数（压缩后） |
| `originalSize` | 本地文件原始字节数 |
| `type` | 文件 MIME 类型 |
| `error` | 仅 `error` 分类中存在，错误信息 |

`--dry-run` 不记录日志；日志写入失败不影响上传结果和退出码。

## 作为 Agent Skill 使用

本仓库同时是 [Agent Skills](https://github.com/anthropics/skills) 格式的技能。将整个目录复制到 Agent 的技能目录，例如：

- Kimi Code: `~/.agents/skills/upload-cloud/`
- Claude Code: `~/.claude/skills/upload-cloud/`

然后在 Agent 里说"把 xx 文件上传到 OSS / 腾讯云 / 图床"即可触发。Agent 会读取 `SKILL.md` 中的工作流：识别服务商 → 解析配置 → 准备脚本 → 执行上传 → 返回 URL。

## 目录结构

```
upload-cloud/
├── SKILL.md              # 技能定义（Agent 工作流说明）
├── upload.js             # 上传脚本（ES Module，可独立运行）
├── package.json
├── config.toml.example   # 配置模板（复制为 config.toml 使用）
└── .gitignore            # 排除 config.toml / node_modules
```

## License

MIT
