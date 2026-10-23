// Faux pont de l'édition bureau, pour les tests : chaque fonction est un espion qui
// répond « rien de choisi, tout refusé » tant qu'un test ne lui donne pas mieux.
import { vi } from 'vitest';
import type { DesktopBridge } from './desktopBridge';

export function fauxPont(over: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    desktop: true,
    pickFile: vi.fn().mockResolvedValue(null),
    openPath: vi.fn().mockResolvedValue({ ok: false, error: 'non prévu dans ce test' }),
    backupFolder: vi.fn().mockResolvedValue(null),
    chooseBackupFolder: vi.fn().mockResolvedValue(null),
    forgetBackupFolder: vi.fn().mockResolvedValue(true),
    writeBackup: vi.fn().mockResolvedValue({ ok: false, error: 'non prévu dans ce test' }),
    takePendingBackup: vi.fn().mockResolvedValue(null),
    onBackupOpened: vi.fn().mockReturnValue(() => {}),
    ...over,
  };
}
