import { useCallback, useId, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '../lib/utils';
import {
  ROOM_CODE_LENGTH,
  formatInviteCode,
  isValidInviteCode,
  sanitizeInviteCode
} from '../lib/inviteCode';

interface InviteCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
}

export function InviteCodeInput({
  value,
  onChange,
  onSubmit,
  disabled,
  autoFocus,
  id
}: InviteCodeInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const isComplete = isValidInviteCode(value);

  const handleChange = useCallback(
    (raw: string) => {
      onChange(sanitizeInviteCode(raw));
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' && isValidInviteCode(value)) {
        event.preventDefault();
        onSubmit?.();
      }
    },
    [onSubmit, value]
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>) => {
      event.preventDefault();
      handleChange(event.clipboardData.getData('text'));
    },
    [handleChange]
  );

  return (
    <div className="grid gap-3">
      <label htmlFor={inputId} className="text-sm font-medium text-zinc-300">
        Invite code
      </label>

      <div
        className={cn(
          'rounded-2xl border bg-zinc-950/70 p-4 transition focus-within:border-blue-400/60 focus-within:ring-2 focus-within:ring-blue-500/20',
          isComplete ? 'border-emerald-500/40 ring-1 ring-emerald-500/20' : 'border-zinc-700',
          disabled && 'opacity-50'
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={ROOM_CODE_LENGTH}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-describedby={hintId}
          aria-invalid={value.length > 0 && !isComplete}
          placeholder="ABC234"
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="w-full bg-transparent text-center font-mono text-3xl font-semibold tracking-[0.45em] text-zinc-100 uppercase outline-none placeholder:tracking-[0.45em] placeholder:text-zinc-600"
        />

        <div className="mt-4 grid grid-cols-6 gap-2">
          {Array.from({ length: ROOM_CODE_LENGTH }, (_, index) => {
            const character = value[index] ?? '';
            const isActive = value.length === index;

            return (
              <div
                key={index}
                aria-hidden
                className={cn(
                  'flex h-11 items-center justify-center rounded-xl border font-mono text-lg font-semibold transition',
                  character
                    ? 'border-blue-400/30 bg-blue-500/10 text-blue-100'
                    : isActive
                      ? 'border-blue-400/50 bg-blue-500/5 text-zinc-500'
                      : 'border-zinc-800 bg-black/20 text-zinc-600'
                )}
              >
                {character || '·'}
              </div>
            );
          })}
        </div>
      </div>

      <div id={hintId} className="flex items-center justify-between gap-3 text-xs text-zinc-500">
        <span>Paste or type six characters (A–Z, 2–9).</span>
        <span className={cn(isComplete && 'font-medium text-emerald-400')}>
          {value.length}/{ROOM_CODE_LENGTH}
          {isComplete ? ' · Press Enter to continue' : ''}
        </span>
      </div>

      {value.length > 0 ? (
        <p className="text-center font-mono text-sm tracking-widest text-zinc-500">
          {formatInviteCode(value)}
        </p>
      ) : null}
    </div>
  );
}
