function text(value = '', max = 5000) { return String(value ?? '').trim().slice(0, max); }
export async function settleNamedDeliveryJobs(jobs = []) {
  const settled = await Promise.allSettled(jobs.map((job) => job.promise));
  return settled.map((item, index) => item.status === 'fulfilled' ? item.value : {
    channel: text(jobs[index]?.channel, 32) || 'unknown',
    status: 'failed',
    detail: item.reason instanceof Error ? item.reason.message : String(item.reason || '通知发送失败')
  });
}
