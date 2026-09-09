const REBIND_COPY = {
  bark: {
    confirm: '检测到这条 Bark 配置已绑定其他账号，且 Device Key 与云端记录一致。需要先解绑原有绑定。是否解绑并绑定到当前账号？',
    cancelled: '已保留原有 Bark 绑定。'
  },
  serverchan3: {
    confirm: '检测到这组 Server酱³ UID 和 SendKey 已绑定其他账号，且与你输入的内容一致。需要先解绑原有绑定。是否解绑并绑定到当前账号？',
    cancelled: '已保留原有 Server酱³ 绑定。'
  }
};

export async function saveNotificationChannelWithRebind(saveSettings, payload, channel, setMessage) {
  try {
    return await saveSettings(payload);
  } catch (error) {
    if (error?.code !== 'CHANNEL_REBIND_REQUIRED' || error?.data?.channel !== channel) throw error;
    const copy = REBIND_COPY[channel];
    if (!copy || !window.confirm(copy.confirm)) {
      if (copy) setMessage(copy.cancelled);
      return null;
    }
    return saveSettings({ ...payload, rebindChannel: channel });
  }
}
