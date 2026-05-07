# 数据同步 / 备份（backup）

- 入口组件：[`src/pages/BackupExperience.jsx`](../../src/pages/BackupExperience.jsx)（约 450 行）
- 同步层：[`src/app/webdavBackup.js`](../../src/app/webdavBackup.js)
- 服务端 CORS 代理：`workers/webdav-cors-proxy/`（部署后落在 `https://tools.freebacktrack.tech/api/webdav`）

这个 tab 让用户把所有 localStorage 数据打包成一份 JSON，写到任意 WebDAV 服务（坚果云 / NextCloud / 自建 dav.example.com 都行）。备份文件名固定 `ai-dca-backup.json`，覆盖式写入。

## 一、3 个 SectionHeading 区域

### 1. WebDAV 配置 / 服务器与账号

字段：

| Label | placeholder | 说明 |
|---|---|---|
| 服务地址 | `https://dav.example.com/dav` | 用户原始 dav 地址 |
| 备份目录 | `/ai-dca-backup/` | 文件名固定 `ai-dca-backup.json`，首次上传时自动创建 |
| 用户名 | `username` | |
| 密码 | `••••••••` | 受 `showPassword` 控制是否明文 |
| CORS 代理（可选） | `https://tools.freebacktrack.tech/api/webdav` | 浏览器走 dav 多半会撞 CORS / Basic Auth；通过这个 worker 中转可以解决。代码里也有提示卡片提示用户「如果你的 WebDAV 没有 CORS 也没有暴露 PROPFIND，请填这个地址」 |

保存：`saveWebDavConfig(config)` 写 localStorage `aiDcaWebDavConfig`。

「连接测试」按钮：`testWebDavConnection(config)` → 走 `OPTIONS` + `PROPFIND` 的轻量探测，结果用一颗 `Wifi` 图标 +`Pill` 反映。

### 2. 同步操作 / 上传到 WebDAV / 从 WebDAV 恢复

| 按钮 | 调用 | 行为 |
|---|---|---|
| 上传到 WebDAV | `buildBackupEnvelope` → `uploadBackupToWebDav(config, envelope)` | 把当前 localStorage 全集打包，PUT 到目标 url |
| 从 WebDAV 恢复 | `downloadBackupFromWebDav(config)` → `applyBackupEnvelope(envelope, { wipePrefix: true })` | 拉回 envelope，**先 wipe `aiDca*` 前缀的所有 key**，再写入 |
| 导出本地 JSON | `downloadLocalBackupAsFile(envelope)` | 直接触发浏览器下载，不走网络 |
| 上传当前文件 | `applyBackupEnvelope(envelope)` | 用户手动上传一个 backup.json 还原 |

所有操作期间通过 `busy = '' | 'upload' | 'download' | 'apply' | ...` 控制按钮 disabled，避免重复请求。结果用 `showToast` 提示成功 / 失败，并写 `lastSync` → `writeLastSyncMeta`。

### 3. 备份清单 / 本次会打包的本地数据

表格列：`localStorage Key` + `字节数` + `条目数（如果是数组）`。

- 数据由 `collectBackupPayload()` 收集，只取以 `aiDca` 开头的 key（隔离用户其他站点数据）。
- 顶部摘要：`{preview.keys.length} 项 · {formatBytes(totalBytes)} · 覆盖式写入 ai-dca-backup.json`。

## 二、上次同步状态徽章

顶部右上角：

- `lastSync = null` → `Pill tone="slate">尚未同步</Pill>`
- 否则按时间新旧映射 tone（emerald 24h 内 / amber 7 天内 / red 更久），文案 `formatDateTime(meta.iso)`。

## 三、状态键速查

React state：

```
config                # WebDAV 配置（urlBase / dir / username / password / proxyUrl）
dirty                 # 表单未保存
showPassword
busy                  # 当前正在执行的操作
lastSync              # { iso, action, byteSize }
preview               # { entries: { [key]: { bytes, count } }, keys: [] }
```

localStorage：

```
aiDcaWebDavConfig         # WebDAV 配置（WEBDAV_CONFIG_KEY）
aiDcaWebDavLastSync       # 最近一次同步元信息（WEBDAV_META_KEY）
```

备份 envelope shape：

```
{
  "version": <int>,
  "createdAt": <ISO>,
  "entries": { [key]: <string JSON | string> }
}
```

## 四、`webdavBackup.js` 函数全集

```
loadWebDavConfig() / saveWebDavConfig(config) / clearWebDavConfig()
loadLastSyncMeta() / writeLastSyncMeta(meta)
collectBackupPayload()                      # 扫所有 aiDca* key
buildBackupEnvelope()                       # collectBackupPayload + 包 version / createdAt
applyBackupEnvelope(envelope, { wipePrefix }) # 应用 envelope，可选 wipe 旧数据
testWebDavConnection(config)                # OPTIONS + PROPFIND
uploadBackupToWebDav(config, envelope)      # PUT
downloadBackupFromWebDav(config)            # GET
downloadLocalBackupAsFile(envelope)         # blob → a[href]
formatBytes(bytes) / formatDateTime(iso)    # 工具
```

## 五、为什么需要 CORS 代理 worker

- 主流 WebDAV 服务为了安全默认 **不允许** 浏览器跨域 `Authorization` 头。
- `workers/webdav-cors-proxy/` 是一个极薄的 Cloudflare Worker：拿到前端的请求 → 用 fetch 透传到目标 dav → 把响应回传给浏览器，并补齐允许跨域的响应头。
- 用户也可以选择不用这个代理，直接用支持 CORS 的 dav 地址（少数自建场景）。
