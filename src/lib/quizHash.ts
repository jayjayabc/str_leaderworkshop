// 참가자 id는 곧 제출 권한이므로 화면·폰으로 방송하는 데이터에는 id 대신 이 해시를 싣는다 (Quiz v1.3).
// uuid(122비트 난수)라 해시에서 id를 되찾을 수 없다.

export async function pidHash(id: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`eb-quiz:${id}`));
  return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
