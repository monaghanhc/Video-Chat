import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { copyText } from '../lib/clipboard';
import { formatInviteCode } from '../lib/inviteCode';
import { Button } from './ui/button';

interface InviteCodeShareProps {
  code: string;
  compact?: boolean;
}

export function InviteCodeShare({ code, compact }: InviteCodeShareProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    setCopyError(false);
    const didCopy = await copyText(code);
    setCopied(didCopy);
    setCopyError(!didCopy);
  }, [code]);

  if (compact) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-xl border border-zinc-700 bg-zinc-950/70 px-3 py-2 font-mono text-sm tracking-[0.35em] text-zinc-100">
          {code}
        </span>
        <Button variant="outline" size="default" onClick={() => void handleCopy()}>
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy code'}
        </Button>
        {copyError ? <span className="text-xs text-rose-300">Copy failed — select the code manually.</span> : null}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-blue-400/20 bg-blue-500/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-100">Share this invite code</p>
          <p className="mt-1 text-xs text-blue-200/70">Others enter it on the welcome screen to join your room.</p>
          <p className="mt-4 font-mono text-4xl font-semibold tracking-[0.35em] text-white">{code}</p>
          <p className="mt-2 font-mono text-sm tracking-widest text-blue-200/60">{formatInviteCode(code)}</p>
        </div>
        <Button variant="secondary" onClick={() => void handleCopy()}>
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied!' : 'Copy invite code'}
        </Button>
      </div>
      {copyError ? (
        <p className="mt-3 text-xs text-rose-200">Could not copy automatically. Select the code above and copy it manually.</p>
      ) : null}
    </div>
  );
}
