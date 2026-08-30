'use client';

/**
 * The Code Guru platform bar — PairPath's copy.
 *
 * Hand-transcribed from the master at
 * code-coach/portal/src/components/CodeGuruBar.jsx, because this is a Next +
 * TypeScript app and the other three are Vite + JSX. The markup and the class
 * names are identical on purpose: all four render from the same `.cg-bar-*`
 * rules in codeguru-theme.css, so the chrome does not change as a student
 * crosses between origins.
 *
 * When the master changes, change this too — code-coach/sync-codeguru-shared.sh
 * reports it as needing a manual pass rather than overwriting TypeScript with
 * JavaScript.
 */
import React from 'react';

export type CodeGuruUser = {
  full_name?: string | null;
  fullName?: string | null;
  email?: string | null;
} | null;

export const CG_SERVICES = [
  { key: 'home', label: 'Home' },
  { key: 'study-guider', label: 'Study Guider' },
  { key: 'pairpath', label: 'PairPath' },
  { key: 'gamification', label: 'Games' },
];

/** "Jane Student" -> "JS"; falls back to the email, then to a neutral glyph. */
export function cgInitials(user: CodeGuruUser): string {
  const name = user?.full_name || user?.fullName || user?.email || '';
  const parts = String(name).trim().split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Props = {
  service: string;
  portalUrl: string;
  user: CodeGuruUser;
  onSignOut?: () => void;
};

export default function CodeGuruBar({ service, portalUrl, user, onSignOut }: Props) {
  const base = String(portalUrl || '').replace(/\/+$/, '');
  const displayName = user?.full_name || user?.fullName || user?.email || '';
  const current = CG_SERVICES.find((s) => s.key === service);

  function hrefFor(key: string): string {
    if (key === 'home') return base + '/';
    // The service you are already in links to its own root, so the current tab
    // is a cheap in-app navigation rather than a round trip through the portal.
    if (key === service) return '/';
    return base + '/go?to=' + encodeURIComponent(key);
  }

  return (
    <header className="cg-bar">
      <div className="cg-bar-inner">
        <a className="cg-bar-brand" href={base + '/'}>
          <span className="cg-bar-mark" aria-hidden="true">CG</span>
          <span className="cg-bar-titles">
            <span className="cg-bar-title">Code Guru</span>
            {current && <span className="cg-bar-service">{current.label}</span>}
          </span>
        </a>

        <nav className="cg-bar-nav" aria-label="Code Guru services">
          {CG_SERVICES.map((s) => (
            <a
              key={s.key}
              className="cg-bar-link"
              href={hrefFor(s.key)}
              aria-current={s.key === service ? 'page' : undefined}
            >
              {s.label}
            </a>
          ))}
        </nav>

        {user && (
          <div className="cg-bar-user">
            <span className="cg-bar-avatar" aria-hidden="true">{cgInitials(user)}</span>
            <span className="cg-bar-username" title={displayName}>{displayName}</span>
            {onSignOut && (
              <button type="button" className="cg-bar-signout" onClick={onSignOut}>
                Sign out
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
