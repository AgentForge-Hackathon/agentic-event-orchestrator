import { Link } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Calendar,
  CalendarDays,
  Clock,
  MapPin,
  Sparkles,
  ArrowRight,
  Ticket,
  CheckCircle2,
  Star,
  TrendingUp,
} from 'lucide-react';
import {
  useItineraries,
  formatTime,
  formatDate,
  formatCost,
  type Itinerary,
} from '@/hooks/useItineraries';

// ─── Dashboard ─────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { data: itineraries = [], isLoading: itinerariesLoading } = useItineraries();

  // Derived stats from real data
  const totalSpent = itineraries.reduce(
    (sum, it) => sum + (it.totalCost?.max ?? 0),
    0,
  );

  // Itineraries whose effective date is in the future = "upcoming", soonest first
  const now = new Date();
  const getEffectiveDate = (it: Itinerary) =>
    it.plannedDate ?? it.items[0]?.time.start ?? null;
  const upcomingItineraries = itineraries
    .filter((it) => {
      const dateStr = getEffectiveDate(it);
      return dateStr ? new Date(dateStr) > now : false;
    })
    .sort((a, b) => {
      const da = new Date(getEffectiveDate(a)!).getTime();
      const db = new Date(getEffectiveDate(b)!).getTime();
      return da - db;
    });

  // Collect all non-null ratings across every itinerary item
  const allRatings = itineraries.flatMap((it) =>
    it.items.map((item) => item.event.rating).filter((r): r is number => r != null),
  );
  const avgRating =
    allRatings.length > 0
      ? (allRatings.reduce((sum, r) => sum + r, 0) / allRatings.length).toFixed(1)
      : null;

  // Show the 3 most recent past itineraries (exclude upcoming ones)
  const pastItineraries = itineraries
    .filter((it) => !upcomingItineraries.includes(it))
    .slice(0, 3);

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <PageHeader
          title="Dashboard"
          description="Welcome back! Here's your event planning overview."
        />

        {/* ── Plan New Event CTA ── */}
        <Card className="mb-12 border-primary/20 bg-primary/5">
          <CardContent className="flex items-center justify-between py-6">
            <div>
              <h2 className="text-xl font-semibold">Ready to plan your next event?</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Let AI discover events, build your schedule, and handle bookings.
              </p>
            </div>
            <Link to="/plan">
              <Button size="lg">
                Plan an Event <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* ── Stats Row ── */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <MetricCard
            icon={Calendar}
            label="Events Planned"
            value={itinerariesLoading ? '—' : String(itineraries.length)}
          />
          <MetricCard
            icon={Ticket}
            label="Upcoming Bookings"
            value={itinerariesLoading ? '—' : String(upcomingItineraries.length)}
          />
          <MetricCard
            icon={Star}
            label="Avg. Rating"
            value={itinerariesLoading ? '—' : (avgRating ?? '—')}
          />
          <MetricCard
            icon={TrendingUp}
            label="Total Spent"
            value={totalSpent > 0 ? `$${totalSpent}` : '—'}
          />
        </div>

        {/* ── Upcoming Bookings + Planning Tips ── */}
        <div className="grid lg:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ticket className="h-5 w-5" aria-hidden="true" />
                Upcoming Bookings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {itinerariesLoading ? (
                [0, 1].map((i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-background animate-pulse"
                  >
                    <div className="w-5 h-5 rounded bg-muted mt-0.5 flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-40 rounded bg-muted" />
                      <div className="h-3 w-56 rounded bg-muted" />
                    </div>
                  </div>
                ))
              ) : upcomingItineraries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No upcoming bookings yet.</p>
              ) : (
                upcomingItineraries.slice(0, 3).map((itinerary) => {
                  const dateStr = itinerary.plannedDate ?? itinerary.items[0]?.time.start;
                  const firstEvent = itinerary.items[0]?.event;

                  return (
                    <div
                      key={itinerary._id}
                      className="flex items-start gap-3 p-3 rounded-lg border bg-background"
                    >
                      <Calendar
                        className="w-5 h-5 text-primary mt-0.5 flex-shrink-0"
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          {itinerary.summary ?? firstEvent?.name ?? 'Upcoming Plan'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {dateStr ? formatDate(dateStr) : ''}
                          {dateStr && firstEvent ? ' at ' : ''}
                          {firstEvent ? formatTime(itinerary.items[0].time.start) : ''}
                          {itinerary.items.length > 0 && (
                            <>
                              {' '}
                              &middot; {itinerary.items.length}{' '}
                              {itinerary.items.length === 1 ? 'event' : 'events'}
                            </>
                          )}
                        </p>
                      </div>
                      <Badge variant="secondary">Upcoming</Badge>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
                Planning Tips
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <TipItem text="Book popular restaurants at least 3 days ahead for weekend dates" />
              <TipItem text="Events near MRT stations make group meetups easier" />
              <TipItem text="Check for early-bird discounts on concerts and workshops" />
            </CardContent>
          </Card>
        </div>

        {/* ── Past Itineraries ── */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Past Itineraries</h2>
          {itineraries.length > 0 && (
            <Link to="/itineraries">
              <Button variant="ghost" size="sm" className="text-primary">
                View all <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
              </Button>
            </Link>
          )}
        </div>

        {/* Loading skeletons */}
        {itinerariesLoading && (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="py-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="space-y-2">
                      <div className="h-4 w-40 rounded bg-muted" />
                      <div className="h-3 w-56 rounded bg-muted" />
                    </div>
                    <div className="h-5 w-16 rounded bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-8 w-full rounded bg-muted" />
                    <div className="h-8 w-full rounded bg-muted" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!itinerariesLoading && pastItineraries.length === 0 && (
          <Card>
            <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
              <Sparkles className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                No itineraries yet — plan your first event above!
              </p>
            </CardContent>
          </Card>
        )}

        {/* Real itinerary cards */}
        {!itinerariesLoading && pastItineraries.length > 0 && (
          <div className="space-y-4">
            {pastItineraries.map((itinerary) => (
              <PastItineraryCard key={itinerary._id} itinerary={itinerary} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

// ─── Past Itinerary Card (condensed dashboard view) ────────────────────────

function PastItineraryCard({ itinerary }: { itinerary: Itinerary }) {
  const cost = formatCost(itinerary.totalCost);
  const itemCount = itinerary.items.length;

  // Derive the date this plan is *for* from the first scheduled event
  const plannedForDate = itinerary.items[0]?.time.start
    ? formatDate(itinerary.items[0].time.start)
    : null;

  return (
    <Card>
      <CardContent className="py-5">
        {/* Title + badge */}
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-semibold leading-snug pr-2">
            {itinerary.summary ?? 'Saved Itinerary'}
          </h3>
          <Badge variant="secondary" className="flex items-center gap-1 flex-shrink-0">
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
            Saved
          </Badge>
        </div>

        {/* ── Date distinction chips ────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 mb-3">
          {/* Planned FOR — accent pill */}
          {plannedForDate && (
            <span
              className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              title="Date the plan is scheduled for"
            >
              <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
              For&nbsp;{plannedForDate}
            </span>
          )}

          {/* Created ON — muted pill */}
          <span
            className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            title="Date this itinerary was saved"
          >
            <Clock className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
            Saved&nbsp;{formatDate(itinerary.createdAt)}
          </span>
        </div>

        {/* Tertiary meta: event count + cost */}
        {(itemCount > 0 || cost) && (
          <p className="text-xs text-muted-foreground mb-3">
            {itemCount > 0 && <>{itemCount} {itemCount === 1 ? 'event' : 'events'}</>}
            {itemCount > 0 && cost && ' · '}
            {cost}
          </p>
        )}

        {/* Items */}
        {itinerary.items.length > 0 && (
          <div className="space-y-2">
            {itinerary.items.map((item, idx) => {
              const timeLabel = formatTime(item.time.start);
              return (
                <div key={idx} className="flex items-center gap-3 text-sm">
                  <Clock
                    className="w-4 h-4 text-muted-foreground flex-shrink-0"
                    aria-hidden="true"
                  />
                  {timeLabel && (
                    <span className="text-muted-foreground w-16 flex-shrink-0">
                      {timeLabel}
                    </span>
                  )}
                  <span className="font-medium truncate">{item.event.name}</span>
                  {item.event.venue && (
                    <span className="text-muted-foreground flex items-center gap-1 ml-auto flex-shrink-0">
                      <MapPin className="w-3 h-3" aria-hidden="true" />
                      {item.event.venue}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────

interface MetricCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}

function MetricCard({ icon: Icon, label, value }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-4">
          <div className="bg-primary/10 rounded-lg p-3">
            <Icon className="w-6 h-6 text-primary" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface TipItemProps {
  text: string;
}

function TipItem({ text }: TipItemProps) {
  return (
    <div className="flex items-start gap-3">
      <Sparkles className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" aria-hidden="true" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
