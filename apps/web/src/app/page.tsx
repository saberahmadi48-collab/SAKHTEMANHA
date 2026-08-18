import type { Metadata } from 'next';
import {
  buildingRoleLabel,
  COMMON,
  FIELDS,
  formatArea,
  formatCurrency,
  formatJalaliDate,
  formatJalaliDateRange,
  formatJalaliPeriod,
  formatNumber,
  formatPhone,
  formatRelativeTime,
  NAV,
  unitKindLabel,
} from '@bops/i18n';

import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';

export const metadata: Metadata = {
  title: NAV.dashboard,
};

/**
 * صفحه‌ی نمایش پوسته‌ی فارسی.
 *
 * این صفحه عمداً با داده‌ی ثابت نوشته شده و هنوز به API وصل نیست: هدفش این
 * است که پیش از پیاده‌سازی ماژول‌های BM-01، بتوان راست‌چین بودن چیدمان،
 * درستی فونت وزیرمتن، تاریخ شمسی و ارقام فارسی را در مرورگر واقعی دید و
 * تأیید کرد. با اتصال ماژول ساختمان در BM-01 جایگزین می‌شود.
 */

const SAMPLE_BUILDINGS = [
  {
    id: '1',
    name: 'مجتمع مسکونی آرامش',
    city: 'تهران',
    units: 48,
    area: 5400,
    balance: 128500000,
    status: 'ACTIVE',
    role: 'BUILDING_MANAGER',
    kind: 'RESIDENTIAL',
    termStart: new Date('2024-03-20T00:00:00Z'),
    updatedAt: new Date(Date.now() - 3 * 86400 * 1000),
    phone: '09121234567',
  },
  {
    id: '2',
    name: 'برج تجاری نگین',
    city: 'اصفهان',
    units: 120,
    area: 18200,
    balance: -4300000,
    status: 'PENDING',
    role: 'BOARD_MEMBER',
    kind: 'COMMERCIAL',
    termStart: new Date('2023-09-23T00:00:00Z'),
    updatedAt: new Date(Date.now() - 2 * 3600 * 1000),
    phone: '09131112233',
  },
  {
    id: '3',
    name: 'مجتمع بهاران',
    city: 'شیراز',
    units: 24,
    area: 2650,
    balance: 0,
    status: 'SUSPENDED',
    role: 'AUDITOR',
    kind: 'RESIDENTIAL',
    termStart: new Date('2024-06-21T00:00:00Z'),
    updatedAt: new Date(Date.now() - 40 * 86400 * 1000),
    phone: '09171234567',
  },
] as const;

export default function DashboardPage(): React.JSX.Element {
  const totalUnits = SAMPLE_BUILDINGS.reduce((sum, b) => sum + b.units, 0);
  const totalBalance = SAMPLE_BUILDINGS.reduce((sum, b) => sum + b.balance, 0);

  return (
    <main id="main-content" className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold text-foreground">
            {NAV.dashboard}
          </h1>
          <p className="text-sm text-muted-foreground">
            خلاصه وضعیت ساختمان‌های تحت مدیریت شما در دوره‌ی{' '}
            {formatJalaliPeriod(new Date())}
          </p>
        </header>

        {/* کارت‌های آماری */}
        <section
          aria-label="آمار کلی"
          className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        >
          <StatCard
            label={NAV.buildings}
            value={formatNumber(SAMPLE_BUILDINGS.length)}
          />
          <StatCard label={FIELDS.totalUnits} value={formatNumber(totalUnits)} />
          <StatCard
            label={FIELDS.balance}
            value={formatCurrency(totalBalance)}
          />
        </section>

        {/* جدول ساختمان‌ها */}
        <section aria-label={NAV.buildings} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-foreground">
            {NAV.buildings}
          </h2>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-start text-sm">
              <thead className="border-b border-border bg-muted/50">
                <tr>
                  <Th>{FIELDS.buildingName}</Th>
                  <Th>{FIELDS.city}</Th>
                  <Th>{FIELDS.unitKind}</Th>
                  <Th>{FIELDS.totalUnits}</Th>
                  <Th>{FIELDS.area}</Th>
                  <Th>{FIELDS.balance}</Th>
                  <Th>{FIELDS.role}</Th>
                  <Th>{FIELDS.termStart}</Th>
                  <Th>{FIELDS.status}</Th>
                  <Th>{FIELDS.updatedAt}</Th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_BUILDINGS.map((building) => (
                  <tr
                    key={building.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <Td className="font-medium">{building.name}</Td>
                    <Td>{building.city}</Td>
                    <Td>{unitKindLabel(building.kind)}</Td>
                    <Td>{formatNumber(building.units)}</Td>
                    <Td>{formatArea(building.area)}</Td>
                    <Td
                      className={
                        building.balance < 0 ? 'text-danger' : 'text-foreground'
                      }
                    >
                      {formatCurrency(building.balance)}
                    </Td>
                    <Td>{buildingRoleLabel(building.role)}</Td>
                    <Td>{formatJalaliDate(building.termStart)}</Td>
                    <Td>
                      <StatusBadge status={building.status} />
                    </Td>
                    <Td className="text-muted-foreground">
                      {formatRelativeTime(building.updatedAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* نمونه‌ی قالب‌بندی‌ها */}
        <section
          aria-label="نمونه قالب‌بندی فارسی"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <InfoCard title="تاریخ و دوره">
            <InfoRow
              label={FIELDS.managementTerm}
              value={formatJalaliDateRange(
                SAMPLE_BUILDINGS[0]?.termStart ?? null,
                null,
              )}
            />
            <InfoRow
              label={FIELDS.period}
              value={formatJalaliPeriod(new Date())}
            />
            <InfoRow label={FIELDS.phone} value={formatPhone('09121234567')} />
          </InfoCard>

          <InfoCard title={COMMON.details}>
            <InfoRow
              label={FIELDS.amount}
              value={formatCurrency(12500000, 'TOMAN')}
            />
            <InfoRow label={FIELDS.area} value={formatArea(95)} />
            {/* نمونه‌ی داده‌ی خالی: قالب‌بندها به‌جای رشته‌ی تهی، خط تیره
                برمی‌گردانند تا سلول جدول بلاتکلیف به نظر نرسد. */}
            <InfoRow label={FIELDS.notes} value={formatCurrency(null)} />
          </InfoCard>
        </section>

        {/* حالت خالی */}
        <section aria-label={NAV.announcements}>
          <h2 className="mb-3 text-lg font-semibold text-foreground">
            {NAV.announcements}
          </h2>
          <EmptyState
            title="اطلاعیه‌ای منتشر نشده است"
            hint="پس از انتشار نخستین اطلاعیه، اینجا نمایش داده می‌شود"
          />
        </section>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function InfoCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <dl className="flex flex-col gap-2">{children}</dl>
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <th
      scope="col"
      className="whitespace-nowrap px-4 py-3 text-start text-xs font-semibold text-muted-foreground"
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <td className={`whitespace-nowrap px-4 py-3 text-start ${className ?? ''}`}>
      {children}
    </td>
  );
}
