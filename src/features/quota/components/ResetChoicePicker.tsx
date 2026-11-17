/**
 * Reset chooser shown in a reset confirmation, so the operator picks which
 * reset credit or grant to spend instead of leaving it to the upstream.
 */

import { Fragment, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRelativeInstant } from '@/utils/quota';
import styles from './ResetChoicePicker.module.scss';

export interface ResetChoice {
  id: string;
  /** Null when the upstream reports no expiry. */
  expiresAtMs: number | null;
  /** Names the choice when the choices are not interchangeable, such as a grant label. */
  label?: string;
  /** Extra facts after the relative expiry, such as resets left. */
  details?: string[];
}

type ResetChoicePickerProps = {
  message: string;
  /** Soonest expiry first; the first choice starts selected. */
  choices: ResetChoice[];
  now: number;
  onChange: (id: string) => void;
};

export function ResetChoicePicker({ message, choices, now, onChange }: ResetChoicePickerProps) {
  const { t, i18n } = useTranslation();
  const groupName = useId();
  const [selected, setSelected] = useState(choices[0]?.id);
  const locale = i18n.resolvedLanguage;
  const firstExpires = choices.length > 1 && choices[0].expiresAtMs !== null;

  return (
    <div className={styles.picker}>
      <p className={styles.message}>{message}</p>
      <div
        className={styles.options}
        role="radiogroup"
        aria-label={t('quota_management.reset_choice_label')}
      >
        {choices.map((choice, index) => {
          const checked = choice.id === selected;
          const date =
            choice.expiresAtMs === null
              ? t('quota_management.reset_choice_no_expiry')
              : t('quota_management.reset_choice_expires', {
                  date: new Date(choice.expiresAtMs).toLocaleString(locale, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                });
          const segments = [
            choice.label ? date : null,
            choice.expiresAtMs === null
              ? null
              : formatRelativeInstant(choice.expiresAtMs, now, locale),
            ...(choice.details ?? []),
          ].filter((segment): segment is string => Boolean(segment));
          return (
            <label
              key={choice.id}
              className={checked ? `${styles.option} ${styles.optionActive}` : styles.option}
            >
              <input
                type="radio"
                name={groupName}
                value={choice.id}
                checked={checked}
                onChange={() => {
                  setSelected(choice.id);
                  onChange(choice.id);
                }}
              />
              <span className={styles.text}>
                <span className={choice.label ? styles.label : styles.date}>
                  {choice.label ?? date}
                </span>
                {segments.length > 0 && (
                  <small className={styles.details}>
                    {segments.map((segment, at) => (
                      <Fragment key={at}>
                        {at > 0 && ' · '}
                        <span className={styles.segment}>{segment}</span>
                      </Fragment>
                    ))}
                  </small>
                )}
              </span>
              {index === 0 && firstExpires && (
                <span className={styles.badge}>
                  {t('quota_management.reset_choice_expires_first')}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
