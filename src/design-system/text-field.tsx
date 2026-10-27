import { useId, type ComponentProps } from 'react';

type TextFieldProps = Omit<ComponentProps<'input'>, 'children'> & {
  label: string;
  hint?: string;
  error?: string | undefined;
};

export function TextField({
  label,
  hint,
  error,
  id,
  className,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const descriptions = [describedBy, hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="ds-field">
      <label htmlFor={inputId} className="ds-field__label">
        {label}
        {props.required ? <span className="ds-field__required"> (required)</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="ds-field__hint">
          {hint}
        </p>
      ) : null}
      <input
        {...props}
        id={inputId}
        className={['ds-input', className].filter(Boolean).join(' ')}
        aria-describedby={descriptions || undefined}
        aria-invalid={error ? true : invalid}
      />
      {error ? (
        <p id={errorId} className="ds-field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
