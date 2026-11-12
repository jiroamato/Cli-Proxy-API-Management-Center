import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconPlus, IconTrash2 } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import type { ModelPrice, UsageSettings } from '@/services/api/usageStats';
import { collectModelPrices, initialPriceRows, type PriceRow } from '../priceForm';
import styles from '../usage.module.scss';

interface ModelPricesModalProps {
  open: boolean;
  settings: UsageSettings;
  unpricedModels: readonly string[];
  builtInCount: number;
  onClose: () => void;
  /** Saves the price overrides; other settings are left as they are. */
  onSave: (modelPrices: Record<string, ModelPrice>) => Promise<void>;
}

/** Adds or overrides list prices, mainly for models the built-in table lacks. */
export function ModelPricesModal(props: ModelPricesModalProps) {
  const { open, settings, unpricedModels, builtInCount, onClose, onSave } = props;
  const { t } = useTranslation();
  const [rows, setRows] = useState<PriceRow[]>(() => initialPriceRows(settings, unpricedModels));
  const [nextId, setNextId] = useState(() => rows.length);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (id: number, patch: Partial<PriceRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setError('');
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { id: nextId, model: '', modelLocked: false, input: '', output: '', cacheRead: '' },
    ]);
    setNextId((id) => id + 1);
  };

  const handleSave = async () => {
    const modelPrices = collectModelPrices(rows);
    if (!modelPrices) {
      setError(t('usage.prices.invalid'));
      return;
    }
    setSaving(true);
    try {
      await onSave(modelPrices);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const priceField = (row: PriceRow, field: 'input' | 'output' | 'cacheRead', label: string) => (
    <input
      className={styles.priceField}
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      value={row[field]}
      placeholder="0.00"
      aria-label={`${row.model || t('usage.prices.model')}: ${label}`}
      onChange={(event) => update(row.id, { [field]: event.target.value })}
    />
  );

  return (
    <Modal
      open={open}
      title={t('usage.prices.title')}
      onClose={onClose}
      width={680}
      closeDisabled={saving}
      footer={
        <div className={styles.priceFooter}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} loading={saving}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <p className={styles.priceIntro}>{t('usage.prices.intro', { count: builtInCount })}</p>
      <div className={styles.priceGrid}>
        <span className={styles.priceHead}>{t('usage.prices.model')}</span>
        <span className={styles.priceHead}>{t('usage.prices.input')}</span>
        <span className={styles.priceHead}>{t('usage.prices.output')}</span>
        <span className={styles.priceHead}>{t('usage.prices.cache_read')}</span>
        <span />
        {rows.map((row) => (
          <div key={row.id} style={{ display: 'contents' }}>
            {row.modelLocked ? (
              <span className={styles.priceModel} title={row.model}>
                {row.model}
              </span>
            ) : (
              <input
                className={styles.priceField}
                type="text"
                value={row.model}
                placeholder={t('usage.prices.model_placeholder')}
                aria-label={t('usage.prices.model')}
                spellCheck={false}
                onChange={(event) => update(row.id, { model: event.target.value })}
              />
            )}
            {priceField(row, 'input', t('usage.prices.input'))}
            {priceField(row, 'output', t('usage.prices.output'))}
            {priceField(row, 'cacheRead', t('usage.prices.cache_read'))}
            {row.modelLocked ? (
              <span />
            ) : (
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('usage.prices.remove', { model: row.model })}
                title={t('usage.prices.remove', { model: row.model })}
                onClick={() => setRows((prev) => prev.filter((item) => item.id !== row.id))}
              >
                <IconTrash2 size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={addRow} style={{ marginTop: 12 }}>
        <IconPlus size={14} aria-hidden="true" /> {t('usage.prices.add')}
      </Button>
      {error && (
        <p className={styles.priceError} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
