'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  MapPin,
  ClipboardList,
  FileText,
  LogOut,
  Menu,
  X,
  Bell,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clearSession, homeForRole, isBackOfficeRole, readSession } from '@/lib/auth';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Attendance', href: '/dashboard/attendance', icon: ClipboardList },
  { name: 'Employees', href: '/dashboard/employees', icon: Users },
  { name: 'Sites', href: '/dashboard/sites', icon: MapPin },
  { name: 'Reports', href: '/dashboard/reports', icon: FileText },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const session = readSession();

    if (!session) {
      router.replace('/');
      return;
    }

    /*
     * A token is not enough to be here, and this guard used to stop there:
     * anything with a stored token reached the whole back office, so an
     * employee who signed in saw every page.
     *
     * A valid non-back-office session is sent to its own screen rather than
     * signed out -- they are signed in, just not here.
     */
    if (!isBackOfficeRole(session.user.role)) {
      router.replace(homeForRole(session.user.role));
      return;
    }

    setUser(session.user);
  }, [router]);

  const handleLogout = () => {
    clearSession();
    router.replace('/');
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-silver-200 border-b-brand-800"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-silver-950/40 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/*
        Sidebar — a solid `brand-800` plane, not a gradient. Lime appears here
        and only here at full strength: on `brand-800` it measures 5.04:1, so it
        is legible as small text and as a rule. On white it would be 1.70:1 and
        is never allowed there.
      */}
      <div
        className={`fixed inset-y-0 left-0 z-30 w-64 bg-brand-800 transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between h-20 px-5">
            {/*
              The artwork is a 1024x285 wordmark — 3.6:1 landscape. A square tile
              with object-contain rendered it 44x12px, which is unreadable, so
              the tile is cut to the artwork's shape. The wordmark already reads
              "Klassic Solutions", so there is no second text lockup beside it —
              the 216px content box cannot fit one without overlapping.
            */}
            <div className="h-12 w-[10.5rem] bg-white rounded-lg flex items-center justify-center px-3 py-2">
              <img
                src="/klassiclogo.png"
                alt="Klassic Solutions"
                className="w-full h-full object-contain"
              />
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-lime-400 hover:bg-white/10 rounded-md p-1 shrink-0"
              aria-label="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors duration-150 ${
                    isActive
                      ? 'bg-brand-700 text-white font-medium'
                      : 'text-brand-100 hover:bg-brand-700/50 hover:text-white'
                  }`}
                >
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-lime-400"
                    />
                  )}
                  <item.icon className="w-[18px] h-[18px] shrink-0" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* User section */}
          <div className="p-3 border-t border-white/10">
            <div className="flex items-center gap-3 px-2 py-2 min-w-0">
              <div className="w-9 h-9 bg-lime-400 rounded-full flex items-center justify-center shrink-0">
                <span className="text-brand-900 font-semibold text-sm">
                  {/* The API returns snake_case (`full_name`); reading
                      `fullName` meant this always fell back to "Admin User". */}
                  {user?.full_name?.[0] || user?.email?.[0] || 'A'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {user?.full_name || 'Signed in'}
                </p>
                <p className="text-xs text-lime-400/90 truncate capitalize">
                  {/* Was falling back to the literal 'HR Manager' for any
                      account whose role was missing, which mislabelled the
                      administrator. The guard above guarantees a real role. */}
                  {user?.role || 'Administrator'}
                </p>
              </div>
            </div>
            {/* `outline` renders a white button here, which is the legible
                choice on a dark green plane. */}
            <Button
              onClick={handleLogout}
              variant="outline"
              className="w-full mt-1 border-transparent"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <div className="sticky top-0 z-10 backdrop-blur-md bg-white/85 border-b border-silver-200">
          <div className="flex items-center h-16 px-6 lg:px-8">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-silver-700 hover:text-brand-800 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="w-6 h-6" />
            </button>

            <div className="flex-1 lg:ml-0 ml-4">
              <h1 className="text-xl font-semibold text-brand-800 leading-tight">
                {navigation.find((item) => item.href === pathname)?.name || 'Dashboard'}
              </h1>
              <p className="text-xs text-silver-800 mt-0.5">
                Welcome back, manage your attendance system
              </p>
            </div>

            <div className="flex items-center gap-1">
              <button
                className="p-2 rounded-lg text-silver-700 hover:bg-silver-100 hover:text-brand-800 transition-colors"
                aria-label="Notifications"
              >
                <Bell className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Page content */}
        <main className="p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
