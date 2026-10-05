export async function request(path, data, method = 'POST') {
  const response = await fetch(path, data === undefined ? undefined : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '接続に失敗しました。');
  return result;
}
