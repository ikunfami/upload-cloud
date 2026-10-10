# upload-cloud

一个 AI Agent Skill + 独立的 Node.js 脚本：把本地任意文件（图片、文档、压缩包等）上传到云存储 —— **阿里云 OSS** 或 **腾讯云 COS**。用户说上传到哪里就上传到哪里；没说时用配置的默认服务商（默认阿里云）。

由 [upload-oss](../upload-oss) 和 [upload-cos](../upload-cos) 融合而来，原有两个 skill 仍然保留。

## 功能特性

- 一个命令支持两个云：阿里云 OSS（`ali-oss`）与腾讯云 COS（`cos-nodejs-sdk-v5`）
- 服务商自动识别：用户说"阿里云 / OSS"→ 阿里云，"腾讯云 / COS"→ 腾讯云
- 配置默认值：用户没指定时回落到 `config.toml` 里的 `provider`（默认 `aliyun`）
- 支持任意文件类型，图片自动压缩（可配默认质量）、限制最大宽高、目标文件大小
- 批量上传（`--file` 可传多个），上传后输出 JSON 公共 URL
- 三种配置方式，按优先级：环境变量 > 脚本旁 `config.toml` > Agent 从 `~/.kimi-code/config.toml` 导出

## 快速开始

要求 Node.js 16+。

```bash
# 1. 安装依赖
npm install

# 2. 配置凭证（两个云的配置都放进去，用哪个填哪个）
cp config.toml.example config.toml
# 编辑 config.toml，填入 OSS / COS 凭证

# 3. 上传
node upload.js --file ./test.png                      # 用默认服务商（阿里云）
node upload.js --file ./test.png --provider tencent   # 指定腾讯云 COS
```

输出示例：

```json
[
  {
    "success": true,
    "provider": "tencent",
    "file": "test.png",
    "key": "uploads/20261010073412244.png",
    "url": "https://my-bucket-1234567890.cos.ap-guangzhou.myqcloud.com/uploads/20261010073412244.png",
    "size": 102400,
    "mime": "image/png"
  }
]
```

## 配置

```toml
[skills.cloud]
provider = "aliyun"   # 默认值：用户没说上传到哪里时用哪个，"aliyun" 或 "tencent"

[skills.cloud.aliyun]
access_key_id = "LTAI..."            # 必填（用阿里云时）
access_key_secret = "..."            # 必填
bucket = "my-bucket"                 # 必填
endpoint = "oss-cn-hangzhou.aliyuncs.com"  # 必填
prefix = "uploads"                   # 可选：上传 key 的前缀目录
public_url = ""                      # 可选：自定义 CDN 域名，留空则用 OSS 虚拟主机式 URL
default_quality = 80                 # 可选：图片默认压缩质量（1-100）

[skills.cloud.tencent]
secret_id = "AKID..."                # 必填（用腾讯云时）
secret_key = "..."                   # 必填
bucket = "my-bucket-1234567890"      # 必填，注意 COS 的 bucket 名称带 APPID 后缀
region = "ap-guangzhou"              # 必填，如 ap-guangzhou / ap-shanghai / ap-beijing
prefix = "uploads"
public_url = ""
default_quality = 80
```

也可以用环境变量代替 `config.toml`：`CLOUD_PROVIDER`（默认服务商）+ `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_BUCKET` / `OSS_ENDPOINT` / `OSS_PREFIX` / `OSS_PUBLIC_URL` / `OSS_DEFAULT_QUALITY` 或 `COS_SECRET_ID` / `COS_SECRET_KEY` / `COS_BUCKET` / `COS_REGION` / `COS_PREFIX` / `COS_PUBLIC_URL` / `COS_DEFAULT_QUALITY`。

> ⚠️ `config.toml` 包含真实凭证，已被 `.gitignore` 排除，不要提交到仓库。

## 服务商如何确定

按优先级逐级回落：

1. 用户指明（"上传到腾讯云"），脚本加 `--provider tencent`
2. 环境变量 `CLOUD_PROVIDER`
3. `config.toml` 的 `[skills.cloud]` 表里的 `provider`，**默认 `aliyun`**

`--provider` 支持别名：`aliyun` / `ali` / `oss` / `alibaba` / `阿里云` 和 `tencent` / `cos` / `qcloud` / `腾讯云`。

## 命令行参数

```
node upload.js --file <path> [--file <path> ...]
  [--provider aliyun|tencent]  # 指定服务商，覆盖默认值
  [--prefix <dir>]             # 覆盖默认前缀
  [--max-width <px>]           # 图片最大宽度（等比缩放）
  [--max-height <px>]          # 图片最大高度
  [--quality <0-100>]          # 压缩质量，覆盖 default_quality
  [--no-compress]              # 不压缩，直接上传原图
  [--max-size <KB>]            # 目标文件大小，超了自动降质量
  [--key <name>]               # 自定义上传 key（默认时间戳命名）
  [--dry-run]                  # 只演练不上传
```

示例：

```bash
# 批量上传到腾讯云，限制宽度 1920
node upload.js --file a.png --file b.jpg --provider tencent --max-width 1920

# 用默认服务商（阿里云）上传到指定目录，压到 500KB 以内
node upload.js --file report.pdf --prefix "docs/2026" --max-size 500
```

## 图片压缩规则

- **默认压缩**：图片默认按 `default_quality`（默认 80）压缩；`--no-compress` 上传原图
- **默认不缩放**：仅显式传 `--max-width` / `--max-height` 时等比缩放到框内
- **保持原格式**：JPEG 仍是 JPEG，PNG 仍是 PNG，不强制转格式
- `--quality` 只对 JPEG / WEBP 生效；PNG 不做质量调整
- **兜底**：压缩结果 ≥ 原图大小时自动回退上传原图，压缩失败也不影响上传

## 作为 Agent Skill 使用

本仓库同时是 [Agent Skills](https://github.com/anthropics/skills) 格式的技能。将整个目录复制到 Agent 的技能目录，例如：

- Kimi Code: `~/.agents/skills/upload-cloud/`
- Claude Code: `~/.claude/skills/upload-cloud/`

然后在 Agent 里说"把 xx 文件上传到 OSS / 腾讯云"即可触发。Agent 会读取 `SKILL.md` 中的工作流：识别服务商 → 解析配置 → 准备脚本 → 执行上传 → 返回 URL。

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
