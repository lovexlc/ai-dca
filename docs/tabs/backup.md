# 数据同步

这一页解决一件事：**把浏览器里的所有数据搬到云端**，方便换浏览器、换电脑、清缓存后恢复。

应用的所有数据（持仓流水、计划、通知配置、切换历史等）都存在浏览器 localStorage。**不在这里备份过 = 换设备就丢**。

## 页面结构

3 个区块（SectionHeading）：

1. **WebDAV 配置（服务器与账号）** — 填服务器地址、账号、密码、CORS 代理
2. **同步操作（上传到 WebDAV / 从 WebDAV 恢复）** — 主要按钮
3. **备份清单（本次会打包的本地数据）** — 列出所有要备份的 localStorage key

---

## 常见操作

### 第一次配置 WebDAV

1. 准备一个 WebDAV 服务（坚果云 / TeraCLOUD / 自建 Nextcloud 等）。
2. 在「WebDAV 配置」区块填：
   - **服务器地址**：示例 `https://dav.example.com/dav`（坚果云是 `https://dav.jianguoyun.com/dav/`）
   - **路径**：示例 `/ai-dca-backup/`（会在 WebDAV 上以这个为根放备份文件）
   - **用户名 / 密码**：你的 WebDAV 凭证（坚果云推荐用「应用密码」而不是登录密码）
   - **CORS 代理**：默认 `https://tools.freebacktrack.tech/api/webdav`，浏览器跨域必须走代理；自部署可以换成自己的
3. 点「**测试连接**」验证一下。绿色提示就是通了。
4. 点「**保存配置**」。

### 上传当前数据

点「**上传到 WebDAV**」。系统会：

1. 把所有 localStorage key 打包成一个 `ai-dca-backup.json` 文件。
2. 通过 CORS 代理 PUT 到你设置的路径。
3. 文件名**固定为 `ai-dca-backup.json`**，每次上传都覆盖。

### 从云端恢复（换设备 / 误删）

点「**从 WebDAV 恢复**」。系统会：

1. 从 WebDAV 下载 `ai-dca-backup.json`。
2. **先清空当前浏览器的所有 ai-dca localStorage**（`wipePrefix=true`）。
3. 再写入备份内容。
4. 完成后页面会自动刷新，所有 tab 重新读取。

### 下载本地备份

如果不想用 WebDAV，「**下载本地备份**」会把同样的 JSON 直接下载到本地文件，命名带时间戳。可以自己存网盘 / 邮箱 / U 盘。

### 看「备份清单」

下方表格列出本次备份会打包哪些 localStorage key（`localStorage Key` 列）和**每项的字节数**。可以判断哪些数据占空间大、是否值得备份。

---

## 常见问题 Q&A

**Q：推荐用哪家 WebDAV？**
A：
- **坚果云**：注册简单，免费 1GB，国内速度好。地址 `https://dav.jianguoyun.com/dav/`。**用应用密码**（账号设置 → 安全选项 → 第三方应用管理）。
- **TeraCLOUD**：日本服务，免费 10GB，注册需要邮箱验证。
- **Nextcloud / 群晖**：自建用户。

**Q：CORS 代理是什么？必须填吗？**
A：浏览器不允许直接访问 WebDAV（跨域被拦），所以必须经过一个代理转发。**默认填 `https://tools.freebacktrack.tech/api/webdav`** 是本应用提供的公共代理（worker 实现的，仅转发请求、不留存数据）。如果有顾虑可以自部署 worker 替换成自己的。

**Q：恢复会不会清掉我现在的数据？**
A：**会**。「从 WebDAV 恢复」会先清空所有 ai-dca 相关 localStorage，再用备份内容覆盖。**恢复前最好先「下载本地备份」**留个副本。

**Q：备份文件名固定是 `ai-dca-backup.json`，怎么留多份历史？**
A：两种办法：
1. 改 WebDAV「路径」为 `/ai-dca-backup-2026-01/` 这种带日期的路径，每月手动改一次。
2. 定期点「下载本地备份」，本地文件名自带时间戳，存网盘 / 移动硬盘。

**Q：换电脑 / 换浏览器怎么搬？**
A：
1. 在**老设备**先点「上传到 WebDAV」（确保「测试连接」是绿的）。
2. 在**新设备**配同样的 WebDAV 信息，点「测试连接」绿了之后，点「**从 WebDAV 恢复**」。
3. 页面自动刷新后，所有数据回来了。

**Q：测试连接报错 401？**
A：用户名或密码错。坚果云用户记得用**应用密码**而不是登录密码。

**Q：测试连接报错 404？**
A：服务器地址或路径不对。检查地址结尾是否多/少了 `/`，路径是否在 WebDAV 上真实存在（坚果云需要先在网页端建好文件夹）。

**Q：测试连接报错 CORS / 网络异常？**
A：CORS 代理地址写错了或代理服务挂了。先把 CORS 代理改回默认 `https://tools.freebacktrack.tech/api/webdav` 试一次。

**Q：上传成功了，但 WebDAV 网页里看不到文件？**
A：检查路径设置——文件可能在你设置的子目录里（比如 `/ai-dca-backup/ai-dca-backup.json`）。

**Q：可以加密备份内容吗？**
A：当前版本明文 JSON 上传。**如果数据敏感**：
- 用支持端到端加密的 WebDAV（如 Cryptomator + 任意 WebDAV）。
- 或用「下载本地备份」拿到 JSON 后自己 7zip 加密码再上传。

**Q：备份清单里看到一个我不认识的 key，能删吗？**
A：那是某个 tab 写入的运行时数据。直接删 localStorage 可能让对应 tab 异常。建议**保留**，整体备份/恢复就好。如果一定要清，去浏览器开发者工具 → Application → Local Storage 手动操作，并先备份。

---

## 相关页面

所有 tab 的数据最终都进这一页备份。如果你新发现一个 tab 的功能要带过去，就来这里上传一次。
