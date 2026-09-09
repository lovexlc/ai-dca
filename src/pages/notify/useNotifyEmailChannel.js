import { useEffect, useState } from 'react';
import {
  disableNotifyEmail,
  enableNotifyEmail,
  sendEmailNotifyTest,
  sendEmailVerificationCode,
  saveNotifyEmail,
  verifyNotifyEmail
} from '../../app/notifySync.js';
import { showActionToast } from '../../app/toast.js';
import { assertNotifyTestDelivered } from '../notifySurfaceHelpers.js';

const EMAIL_CODE_COOLDOWN_SECONDS = 120;

export function useNotifyEmailChannel({
  emailConfigured,
  refreshNotifyData,
  refreshNotifyEvents,
  setNotifyError,
  setNotifyMessage
}) {
  const [emailDraft, setEmailDraft] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [isChangingEmail, setIsChangingEmail] = useState(false);
  const [isSendingEmailCode, setIsSendingEmailCode] = useState(false);
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const [isTogglingEmail, setIsTogglingEmail] = useState(false);
  const [isTestingEmail, setIsTestingEmail] = useState(false);
  const [emailCodeCooldownSeconds, setEmailCodeCooldownSeconds] = useState(0);

  useEffect(() => {
    if (emailCodeCooldownSeconds <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setEmailCodeCooldownSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [emailCodeCooldownSeconds]);

  function handleChangeEmail() {
    setIsChangingEmail(true);
    setEmailDraft('');
    setEmailCode('');
    setEmailCodeCooldownSeconds(0);
    setNotifyError('');
    setNotifyMessage('');
  }

  async function handleSendEmailCode() {
    const email = String(emailDraft || '').trim();
    if (!email) {
      setNotifyError('请输入邮箱地址');
      return;
    }
    setIsSendingEmailCode(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      await sendEmailVerificationCode(email);
      setEmailCodeCooldownSeconds(EMAIL_CODE_COOLDOWN_SECONDS);
      await refreshNotifyData();
      setNotifyMessage('验证码已发送，请在 10 分钟内完成验证。');
      showActionToast('邮箱验证码已发送', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '验证码发送失败';
      setNotifyError(message);
      showActionToast('发送邮箱验证码', 'error', { description: message });
    } finally {
      setIsSendingEmailCode(false);
    }
  }

  async function handleVerifyEmail() {
    const email = String(emailDraft || '').trim();
    const code = String(emailCode || '').trim();
    if (!email || !/^\d{6}$/.test(code)) {
      setNotifyError('请输入邮箱地址和 6 位验证码');
      return;
    }
    setIsVerifyingEmail(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      await verifyNotifyEmail(email, code);
      await saveNotifyEmail(email);
      setEmailCode('');
      setEmailDraft('');
      setEmailCodeCooldownSeconds(0);
      setIsChangingEmail(false);
      await refreshNotifyData();
      setNotifyMessage('邮箱验证成功，邮件提醒已保存并开启。');
      showActionToast('邮箱验证成功', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '邮箱验证失败';
      setNotifyError(message);
      showActionToast('邮箱验证', 'error', { description: message });
    } finally {
      setIsVerifyingEmail(false);
    }
  }

  async function handleToggleEmailEnabled() {
    setIsTogglingEmail(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      if (emailConfigured) {
        await disableNotifyEmail();
        setNotifyMessage('邮件提醒已关闭，邮箱验证状态会保留。');
      } else {
        await enableNotifyEmail();
        setNotifyMessage('邮件提醒已重新开启。');
      }
      await refreshNotifyData();
    } catch (error) {
      const message = error instanceof Error ? error.message : '邮件提醒设置失败';
      setNotifyError(message);
    } finally {
      setIsTogglingEmail(false);
    }
  }

  async function handleTestEmailNotify() {
    setIsTestingEmail(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      const payload = await sendEmailNotifyTest();
      assertNotifyTestDelivered(payload, 'Email 测试通知发送失败');
      await refreshNotifyEvents();
      setNotifyMessage('Email 测试通知已发送。');
      showActionToast('Email 测试通知', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Email 测试通知发送失败';
      setNotifyError(message);
      showActionToast('Email 测试通知', 'error', { description: message });
    } finally {
      setIsTestingEmail(false);
    }
  }

  return {
    emailDraft,
    setEmailDraft,
    emailCode,
    setEmailCode,
    isChangingEmail,
    isSendingEmailCode,
    isVerifyingEmail,
    isTogglingEmail,
    isTestingEmail,
    emailCodeCooldownSeconds,
    handleChangeEmail,
    handleSendEmailCode,
    handleVerifyEmail,
    handleToggleEmailEnabled,
    handleTestEmailNotify
  };
}
