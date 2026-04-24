import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  Download,
  Eye,
  EyeOff,
  FolderSync,
  Loader2,
  RefreshCcw,
  Save,
  ShieldAlert,
  Wifi
} from 'lucide-react';
import { getPrimaryTabs } from '../app/screens.js';
import { showToast } from '../app/toast.js';
import {
  applyBackupEnvelope,
  buildBackupEnvelope,
  collectBackupPayload,
  downloadBackupFromWebDav,
  downloadLocalBackupAsFile,
  formatBytes,
  formatDateTime,
  loadLastSyncMeta,
  loadWebDavConfig,
  saveWebDavConfig,
  testWebDavConnection,
  uploadBackupToWebDav,
  writeLastSyncMeta
} from '../app/webdavBackup.js';
import {
  Card,
  PageShell,
  Pill,
  SectionHeading,
  TopBar,
  cx,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  subtleButtonClass
} from '../components/experience-ui.jsx';

const KEY_LABELS = {
  aiDcaAccumulationState: '加仓模型',
  aiDcaDcaState: '定投计划',
  aiDcaFundHoldingsLedger: '持仓账本',
  aiDcaFundHoldingsState: '持仓状态（旧）',
  aiDcaFundSwitchDocs: '基金切换识别文档',
  aiDcaFundSwitchHistory: '基金切换历史',
  aiDcaFundSwitchSessionState: '基金切换会话',
  aiDcaHomeDashboardState: '首页仪表盘',
  aiDcaNotifyClientConfig: '通知同步配置',
  aiDcaPlanState: '建仓计划（当前）',
  aiDcaPlanStore: '建仓计划（全部）'
};

function describeKey(key) {
  return KEY_LABELS[key] || key;
}

function BackupPreviewRow({ k, value }) {
  const bytes = value ? value.length : 0;
  return (
    <tr className="transition-colors hover:bg-slate-50/70">
      <td className="px-4 py-2.5 font-mono text-[12px] text-slate-500">{k}</td>
      <td className="px-4 py-2.5 text-slate-700">{describeKey(k)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatBytes(bytes)}</td>
    </tr>
  );
}

function StatusPill({ meta }) {
  if (!meta) return <Pill tone="slate">尚未同步</Pill>;
  const tone = meta.direction === 'upload' ? 'indigo' : 'emerald';
  const label = meta.direction === 'upload' ? '最近上传' : '最近恢复';
  return (
    <Pill tone={tone}>
      {label} · {formatDateTime(meta.at)}
    </Pill>
  );
}

export function BackupExperience({ links, embedded = false }) {
  const primaryTabs = getPrimaryTabs(links);

  const [config, setConfig] = useState(() => ({
    baseUrl: '',
    username: '',
    password: '',
    remoteDir: '/ai-dca-backup/',
    proxyUrl: ''
  }));
  const [dirty, setDirty] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState('');
  const [lastSync, setLastSync] = useState(null);
  const [preview, setPreview] = useState({ entries: {}, keys: [] });

  const refreshPreview = useCallback(() => {
    setPreview(collectBackupPayload());
  }, []);

  useEffect(() => {
    const saved = loadWebDavConfig();
    if (saved) {
      setConfig(saved);
    }
    setLastSync(loadLastSyncMeta());
    refreshPreview();
  }, [refreshPreview]);

  const totalBytes = useMemo(
    () => preview.keys.reduce((acc, key) => acc + (preview.entries[key]?.length || 0), 0),
    [preview]
  );

  function updateField(field, value) {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
  }

  function handleSaveConfig() {
    try {
      saveWebDavConfig(config);
      setDirty(false);
      showToast({ title: '配置已保存', description: '下次进入会自动读回', tone: 'emerald' });
    } catch (err) {
      showToast({ title: '保存失败', description: err?.message || String(err), tone: 'red' });
    }
  }

  async function handleTest() {
    setBusy('test');
    try {
      const result = await testWebDavConnection(config);
      showToast({
        title: '连接成功',
        description: result.dirExists
          ? `远端目录可访问（HTTP ${result.status}）`
          : `服务器可达，目录将在首次上传时创建`,
        tone: 'emerald'
      });
    } catch (err) {
      showToast({ title: '连接失败', description: err?.message || String(err), tone: 'red' });
    } finally {
      setBusy('');
    }
  }

  async function handleUpload() {
    if (!preview.keys.length) {
      showToast({ title: '没有可上传的数据', description: '本地暂无任何 ai-dca 数据', tone: 'amber' });
      return;
    }
    setBusy('upload');
    try {
      const envelope = buildBackupEnvelope();
      const meta = await uploadBackupToWebDav(config, envelope);
      setLastSync(meta);
      showToast({
        title: '已上传到 WebDAV',
        description: `${envelope.keyCount} 项 · ${formatBytes(meta.bytes)}`,
        tone: 'emerald'
      });
    } catch (err) {
      showToast({ title: '上传失败', description: err?.message || String(err), tone: 'red' });
    } finally {
      setBusy('');
    }
  }

  async function handleRestore() {
    const confirmed = window.confirm(
      '从 WebDAV 恢复会覆盖当前浏览器本地的 ai-dca 数据，且不可撤销。是否继续？'
    );
    if (!confirmed) return;
    setBusy('restore');
    try {
      const { envelope, remotePath } = await downloadBackupFromWebDav(config);
      const { restoredKeyCount } = applyBackupEnvelope(envelope, { wipePrefix: true });
      const meta = {
        at: new Date().toISOString(),
        bytes: JSON.stringify(envelope).length,
        keyCount: restoredKeyCount,
        direction: 'restore',
        remotePath
      };
      writeLastSyncMeta(meta);
      setLastSync(meta);
      refreshPreview();
      showToast({
        title: '已从 WebDAV 恢复',
        description: `已写入 ${restoredKeyCount} 项，刷新页面后生效`,
        tone: 'emerald',
        durationMs: 5000
      });
    } catch (err) {
      showToast({ title: '恢复失败', description: err?.message || String(err), tone: 'red' });
    } finally {
      setBusy('');
    }
  }

  function handleDownloadLocal() {
    try {
      const envelope = buildBackupEnvelope();
      downloadLocalBackupAsFile(envelope);
    } catch (err) {
      showToast({ title: '导出失败', description: err?.message || String(err), tone: 'red' });
    }
  }

  const uploadDisabled = busy !== '' || !config.baseUrl || !config.username;
  const restoreDisabled = busy !== '' || !config.baseUrl || !config.username;

  const content = (
    <div className={cx('mx-auto max-w-5xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
      <Card>
        <SectionHeading
          eyebrow="WebDAV 配置"
          title="服务器与账号"
          description="凭据会以明文形式保存在浏览器 localStorage 中，仅用于当前设备自动登录。"
          action={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={cx(subtleButtonClass)}
                onClick={handleTest}
                disabled={busy === 'test'}
              >
                {busy === 'test' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wifi className="h-4 w-4" />
                )}
                测试连接
              </button>
              <button
                type="button"
                className={cx(secondaryButtonClass)}
                onClick={handleSaveConfig}
                disabled={!dirty}
              >
                <Save className="h-4 w-4" />
                保存配置
              </button>
            </div>
          }
        />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm text-slate-600">
            <span className="font-semibold text-slate-700">服务器地址</span>
            <input
              className={inputClass}
              placeholder="https://dav.example.com/dav"
              value={config.baseUrl}
              onChange={(event) => updateField('baseUrl', event.target.value)}
              autoComplete="off"
              spellCheck="false"
            />
            <span className="block text-xs text-slate-400">包含协议与路径前缀，不用带结尾 /</span>
          </label>
          <label className="space-y-1.5 text-sm text-slate-600">
            <span className="font-semibold text-slate-700">远端目录</span>
            <input
              className={inputClass}
              placeholder="/ai-dca-backup/"
              value={config.remoteDir}
              onChange={(event) => updateField('remoteDir', event.target.value)}
              autoComplete="off"
              spellCheck="false"
            />
            <span className="block text-xs text-slate-400">首次上传时会自动创建，文件名固定为 ai-dca-backup.json</span>
          </label>
          <label className="space-y-1.5 text-sm text-slate-600">
            <span className="font-semibold text-slate-700">用户名</span>
            <input
              className={inputClass}
              placeholder="username"
              value={config.username}
              onChange={(event) => updateField('username', event.target.value)}
              autoComplete="off"
              spellCheck="false"
            />
          </label>
          <label className="space-y-1.5 text-sm text-slate-600">
            <span className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">密码 / App Token</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPassword ? '隐藏' : '显示'}
              </button>
            </span>
            <input
              className={inputClass}
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              value={config.password}
              onChange={(event) => updateField('password', event.target.value)}
              autoComplete="off"
              spellCheck="false"
            />
          </label>
        </div>

        <label className="mt-4 block space-y-1.5 text-sm text-slate-600">
          <span className="font-semibold text-slate-700">CORS 代理地址（推荐）</span>
          <input
            className={inputClass}
            placeholder="https://tools.freebacktrack.tech/api/webdav"
            value={config.proxyUrl}
            onChange={(event) => updateField('proxyUrl', event.target.value)}
            autoComplete="off"
            spellCheck="false"
          />
          <span className="block text-xs text-slate-400">
            纯前端直连第三方 WebDAV 会被浏览器 CORS 拦住。部署仓库里的 Cloudflare Worker（参考 workers/README.md）后把 Worker URL 填这里，留空则直连。
          </span>
        </label>

        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            GitHub Pages 等纯前端页面直连第三方 WebDAV（坚果云、Nextcloud…）会被 CORS 拦下，这是服务器策略问题，与有无自建服务端无关。
            推荐用仓库自带的 Cloudflare Worker 代理脚本（免费、五分钟部署）。如果确认你的 WebDAV 已在服务端开了 CORS，也可以留空代理地址直连。
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeading
          eyebrow="同步操作"
          title="上传到 WebDAV / 从 WebDAV 恢复"
          description="整包导出当前浏览器中的所有 ai-dca 本地数据；恢复会覆盖本地。"
          action={<StatusPill meta={lastSync} />}
        />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <button
            type="button"
            className={cx(
              primaryButtonClass,
              'h-auto min-h-[88px] flex-col items-start gap-2 px-5 py-4 text-left',
              uploadDisabled && 'opacity-60'
            )}
            onClick={handleUpload}
            disabled={uploadDisabled}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {busy === 'upload' ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <CloudUpload className="h-5 w-5" />
              )}
              上传到 WebDAV
            </span>
            <span className="text-[12px] font-medium text-white/80">
              {preview.keys.length} 项 · {formatBytes(totalBytes)} · 覆盖式写入 ai-dca-backup.json
            </span>
          </button>

          <button
            type="button"
            className={cx(
              secondaryButtonClass,
              'h-auto min-h-[88px] flex-col items-start gap-2 px-5 py-4 text-left',
              restoreDisabled && 'opacity-60'
            )}
            onClick={handleRestore}
            disabled={restoreDisabled}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {busy === 'restore' ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <CloudDownload className="h-5 w-5" />
              )}
              从 WebDAV 恢复
            </span>
            <span className="text-[12px] font-medium text-slate-500">
              会清空并覆盖本地 ai-dca 数据，执行前会二次确认
            </span>
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <button type="button" className={cx(subtleButtonClass, 'h-8 px-3 py-1 text-xs')} onClick={handleDownloadLocal}>
            <Download className="h-3.5 w-3.5" />
            另存为本地文件
          </button>
          <button type="button" className={cx(subtleButtonClass, 'h-8 px-3 py-1 text-xs')} onClick={refreshPreview}>
            <RefreshCcw className="h-3.5 w-3.5" />
            刷新预览
          </button>
          {lastSync?.remotePath ? (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              上次写入 {lastSync.remotePath}
            </span>
          ) : null}
        </div>
      </Card>

      <Card>
        <SectionHeading
          eyebrow="备份清单"
          title="本次会打包的本地数据"
          description="自动扫描 localStorage 中以 aiDca 开头的 key，临时/设置类（如 pendingToasts、WebDAV 配置本身）已排除。"
          action={
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <FolderSync className="h-4 w-4 text-slate-400" />
              共 {preview.keys.length} 项 · {formatBytes(totalBytes)}
            </div>
          }
        />
        {preview.keys.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-6 text-sm text-slate-500">
            当前浏览器没有可备份的 ai-dca 数据。先去其它 tab 创建/编辑数据后再回来。
          </div>
        ) : (
          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">localStorage Key</th>
                  <th className="px-4 py-3 font-semibold">模块</th>
                  <th className="px-4 py-3 text-right font-semibold">大小</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {preview.keys.map((key) => (
                  <BackupPreviewRow key={key} k={key} value={preview.entries[key]} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <PageShell>
      <TopBar activeKey="backup" tabs={primaryTabs} />
      {content}
    </PageShell>
  );
}
