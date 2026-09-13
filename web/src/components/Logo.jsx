import { motion } from 'framer-motion';

/** A pitch centre-circle mark — the app's identity in 28 pixels. */
export default function Logo({ size = 34, animate = true }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      initial={animate ? { rotate: -25, opacity: 0 } : false}
      animate={animate ? { rotate: 0, opacity: 1 } : false}
      transition={{ type: 'spring', stiffness: 200, damping: 18 }}
    >
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="40" y2="40">
          <stop stopColor="#5BF5A0" />
          <stop offset="1" stopColor="#12C566" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="37" height="37" rx="11" stroke="url(#lg)" strokeWidth="2.2" />
      <circle cx="20" cy="20" r="7.5" stroke="url(#lg)" strokeWidth="2.2" />
      <path d="M20 1.5v11M20 27.5v11" stroke="url(#lg)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="20" cy="20" r="2.6" fill="url(#lg)" />
    </motion.svg>
  );
}
