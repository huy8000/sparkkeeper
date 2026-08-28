import { useTranslation } from '../i18n';
import { statusFallbackLabel, statusLabelKey } from '../statusLabels';

/**
 * Reactive status enum → localized display text resolver. Known enums resolve
 * through the shared translation key map; unknown future enums fall back to a
 * prettified raw technical value and are never dropped.
 */
export function useStatusText() {
  const { t } = useTranslation();
  return (status: string): string => {
    const key = statusLabelKey(status);
    if (key !== undefined) return t(key);
    return statusFallbackLabel(status) || t('status.unknown');
  };
}
