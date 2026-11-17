/**
 * Reset-credit chooser shown in the Codex reset confirmation, so the operator
 * picks which manual reset to spend instead of leaving it to the backend.
 */

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRelativeInstant, type RedeemableCodexResetCredit } from '@/utils/quota';
import styles from './CodexResetCreditPicker.module.scss';

type CodexResetCreditPickerProps = {
  name: string;
  credits: RedeemableCodexResetCredit[];
  now: number;
  onChange: (creditId: string) => void;
};

export function CodexResetCreditPicker({
  name,
  credits,
  now,
  onChange,
}: CodexResetCreditPickerProps) {
  const { t, i18n } = useTranslation();
  const groupName = useId();
  const [selected, setSelected] = useState(credits[0]?.id);
  const locale = i18n.resolvedLanguage;

  return (
    <div className={styles.picker}>
      <p className={styles.message}>{t('codex_quota.reset_choose_message', { name })}</p>
      <div
        className={styles.options}
        role="radiogroup"
        aria-label={t('codex_quota.reset_choose_label')}
      >
        {credits.map((credit, index) => {
          const checked = credit.id === selected;
          return (
            <label
              key={credit.id}
              className={checked ? `${styles.option} ${styles.optionActive}` : styles.option}
            >
              <input
                type="radio"
                name={groupName}
                value={credit.id}
                checked={checked}
                onChange={() => {
                  setSelected(credit.id);
                  onChange(credit.id);
                }}
              />
              <span className={styles.text}>
                <span className={styles.date}>
                  {t('codex_quota.reset_credit_expires', {
                    date: new Date(credit.expiresAtMs).toLocaleString(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  })}
                </span>
                <small className={styles.relative}>
                  {formatRelativeInstant(credit.expiresAtMs, now, locale)}
                </small>
              </span>
              {index === 0 && credits.length > 1 && (
                <span className={styles.badge}>{t('codex_quota.reset_credit_expires_first')}</span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
