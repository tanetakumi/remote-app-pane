// Owns one viewer, one in-flight operation, and one retry timer.
export function createConnection({ request, parameters, open, visible, onState, onConfigured }) {
  let remote = null;
  let desired = false;
  let state = 'idle';
  let generation = 0;
  let operation = null;
  let retryTimer;
  let deadline;
  let failures = 0;
  let lastError;
  let endReason = '';
  let hadSession = false;
  const update = (next, message = '') => { state = next; onState(next, message); };
  const cancel = () => {
    generation++;
    clearTimeout(retryTimer);
    clearTimeout(deadline);
    operation?.abort();
    operation = null;
    remote?.close();
    remote = null;
  };
  const stop = (message = '') => {
    desired = false;
    hadSession = false;
    endReason = '';
    failures = 0;
    cancel();
    update('idle', message);
  };
  const retry = (immediate = false) => {
    cancel();
    update('reconnecting');
    if (!desired || !visible()) return;
    const delay = immediate ? 0 : Math.min(1000 * 2 ** Math.min(failures++, 4), 15000);
    retryTimer = setTimeout(() => attempt(true), delay);
  };
  const failed = (error, resume) => {
    if (!resume || [400, 401, 403, 410].includes(error.status)) stop(error.message);
    else retry();
  };
  async function attempt(resume, credentials = {}) {
    cancel();
    const current = generation;
    const controller = new AbortController();
    operation = controller;
    update(resume ? 'reconnecting' : 'connecting');
    lastError = null;
    try {
      // Status is informative; the server also enforces resume-only atomically.
      if (resume) {
        const info = await request('/api/status', undefined, 'GET', { signal: controller.signal });
        if (generation !== current) return;
        onConfigured(info.configuredCredentials);
        if (!info.retained) { stop(endReason || (hadSession ? '保持中の接続は終了しました' : '')); return; }
        hadSession = true;
      }
      const params = await parameters();
      if (generation !== current) return;
      const result = await request('/api/connect', { ...credentials, ...params, resume }, 'POST', { signal: controller.signal });
      credentials = null;
      if (generation !== current) return;
      deadline = setTimeout(() => {
        if (generation === current) failed(new Error('画面への接続がタイムアウトしました。'), resume);
      }, 20000);
      remote = open({ ...result,
        isCurrent: () => generation === current,
        onError: error => {
          if (generation !== current) return;
          const status = { 768: 400, 769: 401, 771: 403 }[error.code];
          lastError = Object.assign(new Error(error.message || 'RDP 接続に失敗しました。'), { status });
        },
        onState: next => {
          if (generation !== current) return;
          if (next === 3) {
            clearTimeout(deadline);
            operation = null;
            failures = 0;
            hadSession = true;
            endReason = '';
            update('connected');
          } else if (next === 5) {
            if (lastError?.status) failed(lastError, resume);
            else if (state === 'connected' || state === 'checking') {
              // Kept so a session that ended upstream reports why.
              endReason = lastError?.message || '';
              retry(true);
            }
            else failed(lastError || new Error('接続が切れました。'), resume);
          }
        },
      });
    } catch (error) {
      if (generation === current) failed(error, resume);
    }
  }
  async function restore() {
    if (desired || operation) return;
    desired = true;
    await attempt(true);
  }
  async function resume() {
    if (!visible() || operation || state === 'checking') return;
    if (!desired) return;
    if (state !== 'connected') {
      clearTimeout(retryTimer);
      return attempt(true);
    }
    const current = generation;
    update('checking');
    const healthy = await remote.check();
    if (generation !== current) return;
    if (healthy) update('connected');
    else retry(true);
  }
  return {
    get remote() { return remote; },
    get active() { return desired; },
    connect(credentials) { desired = true; failures = 0; return attempt(false, credentials); },
    restore, resume, stop,
    suspend() { clearTimeout(retryTimer); remote?.reset(); },
  };
}
