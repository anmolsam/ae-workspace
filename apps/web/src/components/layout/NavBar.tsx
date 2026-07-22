import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useMe } from '../../hooks/useMe';
import { AeSwitcher } from './AeSwitcher';

const NAV = [
  { to: '/taskee', label: 'Taskee' },
  { to: '/briefy', label: 'Briefy' },
  { to: '/revy', label: 'Revy' },
] as const;

export function NavBar() {
  const { signOut } = useAuth();
  const { data: me } = useMe();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold tracking-tight text-ink">
            AE Workspace
          </span>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-canvas text-ink'
                      : 'text-ink-muted hover:text-ink'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {me?.isAdmin && <AeSwitcher />}
          {me && (
            <span className="hidden text-sm text-ink-muted sm:inline">{me.email}</span>
          )}
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-md border border-line px-2.5 py-1 text-sm font-medium text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
