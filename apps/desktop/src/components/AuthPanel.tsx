import { useState } from 'react';
import type { AuthUserPublic } from '@deskcall/shared';
import { getStoredUser, login, logout, signup } from '../lib/authSession';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card } from './ui/card';

interface AuthPanelProps {
  signalingServerUrl: string;
}

export function AuthPanel({ signalingServerUrl }: AuthPanelProps) {
  const [user, setUser] = useState<AuthUserPublic | null>(() => getStoredUser());
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setBusy(true);
    setMessage(null);

    try {
      if (mode === 'signup') {
        const created = await signup(signalingServerUrl, { email, password, displayName });
        setUser(created);
        setMessage(`Signed in as ${created.displayName}.`);
      } else {
        const loggedIn = await login(signalingServerUrl, { email, password });
        setUser(loggedIn);
        setMessage(`Welcome back, ${loggedIn.displayName}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await logout(signalingServerUrl);
      setUser(null);
      setMessage('Signed out. Guest access is used for calls.');
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <Card className="grid gap-3 p-4">
        <p className="text-sm text-zinc-300">
          Signed in as <span className="font-medium text-white">{user.displayName}</span>
        </p>
        <Button variant="outline" disabled={busy} onClick={() => void handleLogout()}>
          Sign out
        </Button>
        {message ? <p className="text-xs text-zinc-400">{message}</p> : null}
      </Card>
    );
  }

  return (
    <Card className="grid gap-3 p-4">
      <div className="flex gap-2">
        <Button variant={mode === 'login' ? 'default' : 'outline'} onClick={() => setMode('login')}>
          Log in
        </Button>
        <Button variant={mode === 'signup' ? 'default' : 'outline'} onClick={() => setMode('signup')}>
          Sign up
        </Button>
      </div>
      {mode === 'signup' ? (
        <Input
          placeholder="Display name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          autoComplete="nickname"
        />
      ) : null}
      <Input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
      />
      <Input
        type="password"
        placeholder="Password (12+ characters)"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
      />
      <Button disabled={busy} onClick={() => void handleSubmit()}>
        {mode === 'signup' ? 'Create account' : 'Log in'}
      </Button>
      <p className="text-xs text-zinc-500">Optional. Calls work as a guest without an account.</p>
      {message ? <p className="text-xs text-amber-300">{message}</p> : null}
    </Card>
  );
}
