import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  CLOUD_SYNC_SESSION_EVENT,
  loadCloudSession,
} from "../app/authSession.js";
import {
  ACCOUNT_MIGRATION_EVENT,
  inspectLegacyMigration,
  runLegacyMigration,
} from "../app/legacyMigration.js";
import {
  discardRemoteAndLocalAccountData,
  hasSeenAccountDataNotice,
  markAccountDataNoticeSeen,
} from "../app/accountDataMigrationActions.js";
import { startCloudAutoSync } from "../app/cloudSync.js";
import { cx, inputClass } from "./experience-ui.jsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

const SETTLED = new Set(["imported", "skipped", "no-legacy"]);
const DELETE_TEXT = "删除全部数据";
const SOURCE_SITE_URL = "https://freebacktrack.tech";

export function isCnMigrationNoticeHost(location = globalThis.location) {
  const host = String(location?.hostname || "")
    .trim()
    .toLowerCase();
  return (
    host === "cn.freebacktrack.tech" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    Boolean(globalThis.window?.__AI_DCA_FORCE_MIGRATION_NOTICE__)
  );
}

function formatDate(value = "") {
  if (!value) return "时间未知";
  try {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return value;
  }
}

function OptionCard({
  selected,
  danger = false,
  icon: Icon,
  title,
  description,
  onClick,
}) {
  return (
    <button
      type="button"
      className={cx(
        "flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition focus:outline-none focus:ring-2 focus:ring-offset-2 sm:p-4",
        selected &&
          !danger &&
          "border-indigo-500 bg-indigo-50/80 focus:ring-indigo-500",
        selected && danger && "border-red-400 bg-red-50 focus:ring-red-500",
        !selected && "border-slate-200 bg-white hover:border-slate-300",
      )}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span
        className={cx(
          "flex h-10 w-10 flex-none items-center justify-center rounded-xl",
          danger ? "bg-red-100 text-red-600" : "bg-indigo-100 text-indigo-700",
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-950">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {description}
        </span>
      </span>
    </button>
  );
}

export function AccountDataMigrationModal() {
  const [session, setSession] = useState(() => loadCloudSession());
  const [migration, setMigration] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [mode, setMode] = useState("keep");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const refresh = useCallback(async (nextSession = loadCloudSession()) => {
    if (!isCnMigrationNoticeHost() || !nextSession?.accessToken) {
      setMigration(null);
      setPhase("idle");
      return;
    }
    setPhase("loading");
    setError("");
    try {
      const status = await inspectLegacyMigration(nextSession);
      setMigration(status);
      setMode(status?.needsMigration ? "migrate" : "keep");
      setPhase("ready");
    } catch (requestError) {
      setError(
        requestError?.message || "暂时无法读取旧数据状态，请检查网络后重试。",
      );
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    function handleSession(event) {
      const nextSession = event?.detail?.session || loadCloudSession();
      setSession(nextSession);
      setDismissed(false);
      setResult(null);
      void refresh(nextSession);
    }
    window.addEventListener(CLOUD_SYNC_SESSION_EVENT, handleSession);
    return () =>
      window.removeEventListener(CLOUD_SYNC_SESSION_EVENT, handleSession);
  }, [refresh]);

  useEffect(() => {
    void refresh(session);
  }, [refresh, session?.accessToken, session?.userId, session?.username]);
  useEffect(() => {
    function handleMigration() {
      if (!result) void refresh(loadCloudSession());
    }
    window.addEventListener(ACCOUNT_MIGRATION_EVENT, handleMigration);
    return () =>
      window.removeEventListener(ACCOUNT_MIGRATION_EVENT, handleMigration);
  }, [refresh, result]);

  const status = String(migration?.status || "")
    .trim()
    .toLowerCase();
  const pending = Boolean(migration?.needsMigration);
  const showNotice = SETTLED.has(status) && !hasSeenAccountDataNotice(session);
  const open = Boolean(
    isCnMigrationNoticeHost() &&
    session?.accessToken &&
    !dismissed &&
    (phase === "error" || pending || showNotice || result),
  );
  const needsPassword = pending && Boolean(migration?.needsSecurityPassword);
  const needsOriginalDevice =
    pending && Boolean(migration?.needsOriginalDevice);
  const canMigrate = pending && Boolean(migration?.canMigrateHere);
  const busy = phase === "migrating" || phase === "deleting";
  const showOptions = pending || SETTLED.has(status);
  const deleteConfirmed = deleteText.trim() === DELETE_TEXT;
  const legacySummary = migration?.legacy?.exists
    ? `${Number(migration.legacy.keyCount || 0)} 项旧数据 · ${formatDate(migration.legacy.updatedAt)}`
    : "未检测到需要解密的旧云端数据";

  function dismiss() {
    if (pending || busy) return;
    markAccountDataNoticeSeen(session);
    setDismissed(true);
  }

  async function migrate() {
    if (!pending) return dismiss();
    if (!canMigrate) return;
    if (needsPassword && password.length < 8) {
      setError("请输入至少 8 位的旧版数据安全密码。");
      return;
    }
    setPhase("migrating");
    setError("");
    try {
      const outcome = await runLegacyMigration({
        securityPassword: password,
        useRemembered: true,
        overwrite: false,
      });
      if (!["imported", "no-legacy"].includes(String(outcome?.status || ""))) {
        throw new Error("旧数据中没有可迁移内容。如需继续，请选择清空数据。");
      }
      markAccountDataNoticeSeen(session);
      startCloudAutoSync();
      setResult({
        icon: CheckCircle2,
        tone: "emerald",
        title: "数据迁移完成",
        description: `已迁移 ${Number(outcome?.imported?.length || outcome?.localState?.importedCount || 0)} 个功能数据集。`,
      });
      setPhase("success");
    } catch (migrationError) {
      setError(migrationError?.message || "迁移失败，请核对安全密码后重试。");
      setPhase("ready");
    }
  }

  function useSourceSite() {
    window.location.assign(SOURCE_SITE_URL);
  }

  async function removeAll() {
    if (!deleteConfirmed) return;
    setPhase("deleting");
    setError("");
    try {
      await discardRemoteAndLocalAccountData(session);
      startCloudAutoSync();
      setResult({
        icon: Trash2,
        tone: "slate",
        title: "账号数据已清空",
        description:
          "旧云端密文、新同步数据与本机业务数据均已删除，登录账户仍然保留。",
      });
      setPhase("success");
    } catch (deleteError) {
      setError(
        deleteError?.message || "删除未完成；在成功前不会清除本机数据。",
      );
      setPhase("ready");
    }
  }

  if (!open) return null;
  const ResultIcon = result?.icon || CheckCircle2;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent
        className="bottom-0 top-auto z-[140] flex max-h-[calc(100dvh-0.5rem)] w-full max-w-none translate-x-[-50%] translate-y-0 flex-col gap-0 overflow-hidden rounded-b-none rounded-t-[28px] border-0 bg-white p-0 shadow-2xl sm:bottom-auto sm:top-[50%] sm:max-h-[88vh] sm:w-[calc(100%-1.5rem)] sm:max-w-2xl sm:translate-y-[-50%] sm:rounded-3xl"
        overlayClassName="z-[130] bg-slate-950/65 backdrop-blur-[1px]"
        showCloseButton={false}
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (pending || busy) event.preventDefault();
          else dismiss();
        }}
      >
        {result ? (
          <div className="px-6 py-9 text-center sm:px-10">
            <span
              className={cx(
                "mx-auto flex h-16 w-16 items-center justify-center rounded-2xl",
                result.tone === "emerald"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 text-slate-700",
              )}
            >
              <ResultIcon className="h-8 w-8" aria-hidden="true" />
            </span>
            <DialogTitle className="mt-5 text-2xl font-bold text-slate-950">
              {result.title}
            </DialogTitle>
            <DialogDescription className="mx-auto mt-2 max-w-md leading-6 text-slate-500">
              {result.description}
            </DialogDescription>
            <button
              type="button"
              className="mt-7 h-11 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white"
              onClick={() => window.location.reload()}
            >
              重新加载并继续
            </button>
          </div>
        ) : (
          <>
            <header className="relative flex-none overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-4 py-4 text-white sm:px-7 sm:pb-7 sm:pt-6">
              <div className="absolute -right-12 -top-16 h-48 w-48 rounded-full bg-indigo-500/20 blur-3xl" />
              {!pending && !busy ? (
                <button
                  type="button"
                  className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
                  onClick={dismiss}
                  aria-label="关闭数据安全更新提醒"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
              <div className="relative flex items-start gap-3 pr-9 sm:gap-4">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 sm:h-11 sm:w-11 sm:rounded-2xl">
                  <ShieldCheck
                    className="h-6 w-6 text-indigo-200"
                    aria-hidden="true"
                  />
                </span>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold tracking-[0.18em] text-indigo-200">
                    数据安全更新
                  </div>
                  <DialogTitle className="mt-1.5 text-lg font-bold leading-tight text-white sm:text-2xl">
                    {pending ? "请先处理旧版加密数据" : "账号同步方式已升级"}
                  </DialogTitle>
                  <DialogDescription className="mt-1.5 text-xs leading-5 text-slate-300 sm:text-sm sm:leading-6">
                    cn 站已停止整包强加密同步，改为更稳定的按功能同步。
                  </DialogDescription>
                </div>
              </div>
            </header>

            <main className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 py-4 sm:px-7 sm:py-6">
              {phase === "error" && !migration ? (
                <div className="flex min-h-52 flex-col items-center justify-center text-center">
                  <AlertTriangle className="h-8 w-8 text-amber-500" />
                  <div className="mt-3 text-sm font-bold text-slate-900">
                    暂时无法读取迁移状态
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">
                    {error}
                  </div>
                  <button
                    type="button"
                    className="mt-5 flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold"
                    onClick={() => void refresh(session)}
                  >
                    <RefreshCw className="h-4 w-4" />
                    重新检查
                  </button>
                </div>
              ) : (
                <div className="space-y-4 sm:space-y-5">
                  <section className="rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 sm:px-4 sm:py-3.5">
                    <div className="flex items-start gap-3">
                      <KeyRound className="mt-0.5 h-5 w-5 flex-none text-amber-700" />
                      <div>
                        <div className="text-sm font-bold text-amber-950">
                          同步安全方式发生变化
                        </div>
                        <p className="mt-1 text-xs leading-5 text-amber-900/80">
                          迁移后，包括持仓数据在内的账号数据不再由安全密码进行端到端强加密，服务端会按功能保存可读取的数据。传输仍使用
                          HTTPS，并受账户登录保护。
                        </p>
                        <p className="mt-1.5 text-xs font-semibold leading-5 text-amber-950">
                          本服务不会售卖您的持仓数据，也不会将其用于服务端分析、用户画像或广告用途。如果对此类数据的服务端存储方式不放心，请选择清空或切回源站使用。
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                    <Database className="h-5 w-5 flex-none text-slate-500" />
                    <div>
                      <div className="text-xs font-bold text-slate-800">
                        旧版云端数据
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {legacySummary}
                      </div>
                    </div>
                  </section>

                  {showOptions ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <OptionCard
                        selected={mode !== "delete" && mode !== "source"}
                        icon={pending ? KeyRound : CheckCircle2}
                        title={pending ? "迁移并继续使用" : "保留现有数据"}
                        description={
                          pending
                            ? "在当前浏览器解密后写入新的同步系统。"
                            : "确认了解变化后继续使用现有数据。"
                        }
                        onClick={() => {
                          setMode(pending ? "migrate" : "keep");
                          setError("");
                        }}
                      />
                      <OptionCard
                        selected={mode === "delete"}
                        danger
                        icon={Trash2}
                        title="不迁移，清空数据"
                        description="删除旧云端密文、新同步数据及本机业务数据。"
                        onClick={() => {
                          setMode("delete");
                          setError("");
                        }}
                      />
                      <OptionCard
                        selected={mode === "source"}
                        icon={ExternalLink}
                        title="使用源站"
                        description="切回 freebacktrack.tech 暂时继续使用。"
                        onClick={() => {
                          setMode("source");
                          setError("");
                        }}
                      />
                    </div>
                  ) : null}

                  {mode === "migrate" && pending ? (
                    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3.5 sm:p-4">
                      {needsOriginalDevice ? (
                        <div className="flex gap-2 text-xs leading-5 text-indigo-900">
                          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                          <span>
                            该备份由原设备密钥加密，请在原设备迁移，或选择清空数据。
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className="text-sm font-bold text-slate-900">
                            {needsPassword
                              ? "输入旧版数据安全密码"
                              : "使用本设备密钥迁移"}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            解密只在当前浏览器进行，安全密码不会上传服务器。
                          </p>
                          {needsPassword ? (
                            <label className="mt-3 block text-xs font-semibold text-slate-700">
                              数据安全密码
                              <span className="relative mt-1.5 block">
                                <input
                                  className={cx(inputClass, "h-11 pr-11")}
                                  type={passwordVisible ? "text" : "password"}
                                  value={password}
                                  onChange={(event) =>
                                    setPassword(event.target.value)
                                  }
                                  autoComplete="off"
                                  placeholder="输入原安全密码（至少 8 位）"
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400"
                                  onClick={() =>
                                    setPasswordVisible((value) => !value)
                                  }
                                  aria-label={
                                    passwordVisible
                                      ? "隐藏安全密码"
                                      : "显示安全密码"
                                  }
                                >
                                  {passwordVisible ? (
                                    <EyeOff className="h-4 w-4" />
                                  ) : (
                                    <Eye className="h-4 w-4" />
                                  )}
                                </button>
                              </span>
                            </label>
                          ) : null}
                        </>
                      )}
                    </section>
                  ) : null}

                  {mode === "source" ? (
                    <section className="rounded-2xl border border-sky-200 bg-sky-50 p-3.5 text-xs leading-5 text-sky-900 sm:p-4">
                      <div className="font-bold">源站仅作为临时过渡</div>
                      <p className="mt-1">
                        将跳转到
                        freebacktrack.tech。源站暂时保留现有同步方式，但也将在
                        30
                        天后迁移至未加密逻辑；请在此期间导出或清理不希望以新方式保存的数据。
                      </p>
                    </section>
                  ) : null}

                  {mode === "delete" ? (
                    <section className="rounded-2xl border border-red-200 bg-red-50 p-3.5 sm:p-4">
                      <div className="text-sm font-bold text-red-950">
                        此操作不可恢复
                      </div>
                      <p className="mt-1 text-xs leading-5 text-red-800">
                        登录账户会保留，但旧云端密文、同步资源、历史版本及本机业务数据都会删除。
                      </p>
                      <label className="mt-3 block text-xs font-semibold text-red-900">
                        输入“{DELETE_TEXT}”确认
                        <input
                          className={cx(
                            inputClass,
                            "mt-1.5 h-11 border-red-200 bg-white",
                          )}
                          value={deleteText}
                          onChange={(event) =>
                            setDeleteText(event.target.value)
                          }
                          autoComplete="off"
                          placeholder={DELETE_TEXT}
                        />
                      </label>
                    </section>
                  ) : null}

                  {error ? (
                    <div
                      className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700"
                      role="alert"
                    >
                      {error}
                    </div>
                  ) : null}
                </div>
              )}
            </main>

            {phase !== "loading" && !(phase === "error" && !migration) ? (
              <footer className="flex flex-none flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-4">
                <div className="text-[11px] leading-5 text-slate-400">
                  {pending
                    ? "请选择迁移、清空，或切回源站。"
                    : "此提醒仅在当前账号首次显示。"}
                </div>
                {mode === "source" ? (
                  <button
                    type="button"
                    className="flex h-11 items-center justify-center gap-2 rounded-xl bg-sky-700 px-5 text-sm font-bold text-white"
                    onClick={useSourceSite}
                  >
                    <ExternalLink className="h-4 w-4" />
                    切换到 freebacktrack.tech
                  </button>
                ) : mode === "delete" ? (
                  <button
                    type="button"
                    className="flex h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-bold text-white disabled:opacity-50"
                    onClick={() => void removeAll()}
                    disabled={!deleteConfirmed || busy}
                  >
                    {phase === "deleting" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    {phase === "deleting" ? "正在清空…" : "永久删除全部数据"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white disabled:opacity-50"
                    onClick={() => void migrate()}
                    disabled={
                      busy ||
                      (pending &&
                        (!canMigrate || (needsPassword && password.length < 8)))
                    }
                  >
                    {phase === "migrating" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : pending ? (
                      <KeyRound className="h-4 w-4" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    {phase === "migrating"
                      ? "正在迁移…"
                      : pending
                        ? "开始迁移"
                        : "我已了解，继续使用"}
                  </button>
                )}
              </footer>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
