// 토의보드 송출 화면 색 체계 (Board v1.2) — BoardCast 와 AI 갈무리 리포트(운영자 미리보기 포함)가 함께 쓴다.

export const BOARD_SCREEN_THEMES = {
  dark: {
    '--bg': '#0E0F13',
    '--panel': 'rgba(255,255,255,0.07)',
    '--card': '#1B1D24',
    '--ink': '#FFFFFF',
    '--sub': 'rgba(255,255,255,0.62)',
    '--faint': 'rgba(255,255,255,0.35)',
    '--accent': '#FFE300',
    '--accent-ink': '#1E1E1E',
    '--line': 'rgba(255,255,255,0.12)',
    '--bar': '#FFE300',
    '--bar-track': 'rgba(255,255,255,0.10)',
  },
  light: {
    '--bg': '#F4F2EC',
    '--panel': 'rgba(30,30,30,0.06)',
    '--card': '#FFFFFF',
    '--ink': '#1E1E1E',
    '--sub': 'rgba(30,30,30,0.66)',
    '--faint': 'rgba(30,30,30,0.38)',
    '--accent': '#FFE300',
    '--accent-ink': '#1E1E1E',
    '--line': 'rgba(30,30,30,0.12)',
    '--bar': '#1E1E1E',
    '--bar-track': 'rgba(30,30,30,0.09)',
  },
} as const;
