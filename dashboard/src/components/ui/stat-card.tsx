import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';

/*
 * One KPI tile, shared by every page that shows a row of counts.
 *
 * Before this existed, `dashboard` and `attendance` drew a label-above tile
 * with an icon chip while `employees` and `sites` drew a value-above tile with
 * no icon and a smaller number — the same row of figures, two different
 * designs, on adjacent nav items.
 *
 * The tone rule: `critical` is a signal, so it only fires on a non-zero count.
 * A red "0 Suspended" reads as a problem when the news is good, and it spends
 * the reserved colour on nothing.
 */
export interface StatCardProps {
  label: string;
  value: number | string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Only `critical` is defined — the one status a headline count can carry. */
  tone?: 'critical';
}

export function StatCard({ label, value, icon: Icon, tone }: StatCardProps) {
  const isCritical = tone === 'critical' && Number(value) > 0;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-silver-800 truncate">{label}</p>
            <p
              className={`text-3xl font-semibold mt-1.5 tabular-nums ${
                isCritical ? 'text-critical-600' : 'text-brand-800'
              }`}
            >
              {value}
            </p>
          </div>
          {Icon && (
            <div
              aria-hidden="true"
              className={`p-2.5 rounded-lg shrink-0 ${
                isCritical
                  ? 'bg-critical-50 text-critical-600'
                  : 'bg-brand-50 text-brand-800'
              }`}
            >
              <Icon className="w-5 h-5" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default StatCard;
