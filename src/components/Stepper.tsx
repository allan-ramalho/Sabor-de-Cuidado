interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  max?: number;
  /** Impede aumentar mesmo abaixo do máximo (ex.: kit já completo). */
  lockPlus?: boolean;
  label: string;
}

export function Stepper({ value, onChange, max = 50, lockPlus = false, label }: StepperProps) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= 0} aria-label={`Diminuir ${label}`}>
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={lockPlus || value >= max}
        aria-label={`Aumentar ${label}`}
      >
        +
      </button>
    </div>
  );
}

export function AddButton({ onClick, label, disabled }: { onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" className="add-btn" onClick={onClick} aria-label={`Adicionar ${label}`} disabled={disabled}>
      +
    </button>
  );
}
