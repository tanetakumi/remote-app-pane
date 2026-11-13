export async function request(path, data, method = 'POST', { signal } = {}) {
  const response = await fetch(path, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    ...(data === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  }).catch(error => {
    throw error.name === 'TimeoutError' ? new Error('サーバーの応答がタイムアウトしました。') : error;
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw Object.assign(new Error(result.error || '接続に失敗しました。'), { status: response.status });
  }
  const result = await response.json();
  return result;
}
