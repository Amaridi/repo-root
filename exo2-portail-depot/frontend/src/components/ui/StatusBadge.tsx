import { Badge } from '@chakra-ui/react';

/**
 * Statuts de demande, mappes sur les couleurs semantiques de la charte.
 * Les libelles sont en francais et sur un ton formel, conformement au ton
 * impose (formel, froid, technique, phrases courtes).
 */
type Status = 'PENDING' | 'IN_PROGRESS' | 'SUBMITTED' | 'CLOSED' | 'EXPIRED';

const STYLES: Record<Status, { label: string; fg: string; bg: string }> = {
  PENDING: { label: 'En attente', fg: 'state.warningFg', bg: 'state.warningBg' },
  IN_PROGRESS: { label: 'En cours', fg: 'state.infoFg', bg: 'state.infoBg' },
  SUBMITTED: { label: 'Soumise', fg: 'state.successFg', bg: 'state.successBg' },
  CLOSED: { label: 'Cloturee', fg: 'fg.muted', bg: 'bg.accent' },
  EXPIRED: { label: 'Expiree', fg: 'state.dangerFg', bg: 'state.dangerBg' },
};

export function StatusBadge({ status }: { status: Status }) {
  const s = STYLES[status];
  return (
    <Badge color={s.fg} bg={s.bg} borderRadius="full" px="3" py="1" fontWeight="600">
      {s.label}
    </Badge>
  );
}
