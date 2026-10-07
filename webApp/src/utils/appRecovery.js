export function clearAppStorage(storage = null) {
  try {
    const target = storage || localStorage;
    for (const key of Object.keys(target)) {
      if (key.startsWith('tabak_') || key.startsWith('tabakpp_')) target.removeItem(key);
    }
  } catch { /* Sign-out and reload still work when browser storage is disabled. */ }
}

export async function importWithRecovery(load, buildId, storage = null, reload = () => location.reload()) {
  const key = `tabakpp_chunk_reload_${buildId}`;
  try {
    return await load();
  } catch (error) {
    let retried = true;
    try {
      const target = storage || sessionStorage;
      retried = target.getItem(key) === '1';
      if (!retried) target.setItem(key, '1');
    } catch { /* Storage unavailable: surface the failure without a reload loop. */ }
    if (!retried) {
      reload();
      return { default: () => null };
    }
    throw error;
  }
}
