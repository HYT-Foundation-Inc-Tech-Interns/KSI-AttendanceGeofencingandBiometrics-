'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { clearSession, describeRole, extractSession, isBackOfficeRole, saveSession } from '@/lib/auth';
import { AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  /** Set when a valid employee signs in at this door, so we can offer the
   *  right link instead of just refusing. */
  const [wrongDoor, setWrongDoor] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setWrongDoor(false);

    try {
      const response = await api.login(email, password);
      const { accessToken, refreshToken, user } = extractSession(response);

      /*
       * This is the back-office door. An employee account that signs in here
       * has to be turned away: the credentials are valid, but the dashboard is
       * not their surface, and previously this page redirected every role
       * straight into the admin panel.
       */
      if (!isBackOfficeRole(user.role)) {
        clearSession();
        setWrongDoor(true);
        setError(
          `You signed in with ${describeRole(user.role)}. This page is for administrators — employee accounts check in from the attendance page.`
        );
        return;
      }

      saveSession(accessToken, refreshToken, user);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-page">
      {/*
        Brand panel. This is a dark surface, so it is the one place lime can be
        used as text — `lime-400` on `brand-800` is 5.04:1.
      */}
      <div className="hidden lg:flex flex-col justify-between bg-brand-800 p-12">
        <div className="flex items-center gap-3">
          {/* The artwork is a 3.6:1 landscape wordmark; a square tile squashed it
              to 48x13px. The tile is cut to the artwork and carries the name, so
              there is no second text lockup beside it. */}
          <div className="h-12 w-[10.5rem] bg-white rounded-lg flex items-center justify-center px-3 py-2">
            <img
              src="/klassiclogo.png"
              alt="Klassic Solutions"
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        <div className="max-w-md">
          <h2 className="text-3xl font-semibold text-white leading-snug">
            Field attendance, verified at the gate.
          </h2>
          <p className="mt-4 text-brand-100 leading-relaxed">
            GPS-geofenced timekeeping with on-device biometric verification. Review
            check-ins, resolve flagged events, and export payroll — all from one place.
          </p>
        </div>

        <p className="text-sm text-lime-400">
          Attendance System · HR Dashboard
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md border-silver-200 shadow-sm">
          <CardHeader className="space-y-1">
            {/* The logo again on small screens, where the brand panel is hidden. */}
            <div className="flex justify-center mb-4 lg:hidden">
              <div className="h-14 w-[12rem] bg-white rounded-lg border border-silver-200 flex items-center justify-center px-3 py-2">
                <img
                  src="/klassiclogo.png"
                  alt="Klassic Solutions"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
            <CardTitle className="text-xl text-center">Administrator sign in</CardTitle>
            <CardDescription className="text-center">
              Manage attendance for your field workforce
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 p-3 text-sm text-critical-600 bg-critical-50 border border-critical-200 rounded-lg"
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    {error}
                    {wrongDoor && (
                      <>
                        {' '}
                        <Link
                          href="/checkin"
                          className="font-medium underline underline-offset-2"
                        >
                          Go to check-in
                        </Link>
                        .
                      </>
                    )}
                  </span>
                </div>
              )}
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium text-ink">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@klassic.ph"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  autoComplete="username"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium text-ink">
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isLoading}
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Signing in...
                  </span>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>
            {/*
              The demo-credentials hint that used to sit here printed the
              administrator address and password on the sign-in page. This page
              is served from a public URL, so that is a published admin
              credential, not a convenience. Removed deliberately.
            */}
            <div className="mt-5 pt-4 border-t border-silver-200 text-center text-xs text-silver-800">
              Employees sign in at{' '}
              <Link href="/checkin" className="font-medium text-brand-800 underline underline-offset-2">
                the check-in page
              </Link>
              .
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
