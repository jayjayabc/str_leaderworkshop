'use client';

import { initials, ROLE_LABEL } from '@/lib/design';
import { useBoard } from '@/store/board';

export function PresenceList() {
  const presence = useBoard((s) => s.presence);
  const me = useBoard((s) => s.me);

  return (
    <div className="flex items-center gap-2" aria-label="온라인 참가자">
      <div className="flex -space-x-1.5">
        {presence.slice(0, 8).map((p) => (
          <span
            key={p.participant.id}
            title={`${p.participant.nickname} · ${ROLE_LABEL[p.participant.role]}${
              p.participant.id === me?.id ? ' (나)' : ''
            }`}
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white"
            style={{ background: p.participant.color }}
          >
            {initials(p.participant.nickname)}
          </span>
        ))}
      </div>
      <span className="text-[13px] tabular-nums text-eb-muted">👥 {presence.length}</span>
    </div>
  );
}
