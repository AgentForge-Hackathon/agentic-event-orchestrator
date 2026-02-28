import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles, MapPin, Zap, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const features = [
  {
    icon: Zap,
    label: 'AI-powered',
    detail: 'Instant itineraries',
  },
  {
    icon: MapPin,
    label: 'Local discoveries',
    detail: 'Curated for you',
  },
  {
    icon: Calendar,
    label: 'Smart scheduling',
    detail: 'Zero conflicts',
  },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] } },
};

export function AuthenticatedHome() {
  const { user } = useAuth();
  const greeting = getTimeGreeting();
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <section className="relative min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center overflow-hidden px-4">
      {/* Ambient grid background */}
      <div
        className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-[0.15]"
        style={{
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 50%, black 30%, transparent 100%)',
        }}
        aria-hidden="true"
      />

      {/* Soft glow accents */}
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-primary/10 blur-[120px] rounded-full pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute bottom-1/4 -left-24 w-[300px] h-[300px] bg-primary/8 blur-[80px] rounded-full pointer-events-none"
        aria-hidden="true"
      />

      <motion.div
        className="relative z-10 text-center max-w-2xl w-full"
        variants={container}
        initial="hidden"
        animate="show"
      >
        {/* Greeting chip */}
        <motion.div variants={item} className="flex items-center justify-center gap-2 mb-6">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground tracking-widest uppercase border border-border/60 rounded-full px-4 py-1.5 bg-background/60 backdrop-blur-sm">
            <Sparkles className="w-3 h-3 text-primary" aria-hidden="true" />
            Your AI event planner
          </span>
        </motion.div>

        {/* Main greeting */}
        <motion.h1
          variants={item}
          className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1]"
        >
          {greeting},{' '}
          <span className="text-primary">{firstName}.</span>
        </motion.h1>

        {/* Subheading */}
        <motion.p
          variants={item}
          className="mt-5 text-lg sm:text-xl text-muted-foreground max-w-md mx-auto leading-relaxed"
        >
          What are you planning? Tell us the occasion and we&apos;ll handle
          everything — from discovery to booking.
        </motion.p>
        {/* Primary CTA */}
        <motion.div variants={item} className="mt-10">
          <Link to="/plan">
            <Button
              size="lg"
              className="h-14 px-8 text-base font-semibold rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-shadow"
            >
              Start Planning
              <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" />
            </Button>
          </Link>
        </motion.div>

        {/* Feature pills */}
        <motion.div
          variants={item}
          className="mt-12 flex flex-wrap items-center justify-center gap-3"
        >
          {features.map(({ icon: Icon, label, detail }) => (
            <div
              key={label}
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-border/60 bg-background/60 backdrop-blur-sm"
            >
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10">
                <Icon className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
              </div>
              <div className="text-left">
                <p className="text-xs font-semibold leading-none">{label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-none">{detail}</p>
              </div>
            </div>
          ))}
        </motion.div>
      </motion.div>
    </section>
  );
}
