import { DeFiLogo } from './DeFiLogo'
import { TelemetrySignup } from './TelemetrySignup'

const NAV_LINKS = [
  {
    heading: 'Flows',
    links: [
      { label: 'Bridge automations', href: '#bridge' },
      { label: 'Liquidity vaults', href: '#liquidity' },
      { label: 'Staking rewards', href: '#staking' },
      { label: 'Cross-chain swaps', href: '#swaps' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Docs & API', href: '#docs' },
      { label: 'Security posture', href: '#security' },
      { label: 'Status monitor', href: '#status' },
      { label: 'Changelog', href: '#changelog' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '#about' },
      { label: 'Careers', href: '#careers' },
      { label: 'Support', href: '#support' },
      { label: 'Press kit', href: '#press' },
    ],
  },
]

const SOCIAL_LINKS = [
  { label: 'Twitter', href: 'https://twitter.com', initials: 'X' },
  { label: 'Discord', href: 'https://discord.com', initials: 'D' },
  { label: 'GitHub', href: 'https://github.com', initials: 'GH' },
]

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-x-0 top-[-40%] h-[420px] bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.25),transparent_60%)] blur-3xl" />
        <div className="absolute bottom-[-30%] left-1/2 h-[360px] w-[720px] -translate-x-1/2 rounded-full bg-[linear-gradient(135deg,rgba(56,189,248,0.18),rgba(217,70,239,0.1))] blur-3xl" />
      </div>

      <div className="mx-auto max-w-6xl px-6 py-16 space-y-12">
        <div className="relative overflow-hidden rounded-[36px] border border-white/10 bg-white/[0.03] p-8 sm:p-10 shadow-[0_28px_100px_rgba(6,12,36,0.55)]">
          <div className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/60 to-transparent" />
          <div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-xl space-y-7">
              <div className="flex items-start gap-4">
                <DeFiLogo className="mt-1 h-10 w-10 shrink-0" />
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs uppercase tracking-[0.3em] text-emerald-200">
                    Live Ops
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.8)]" />
                  </div>
                  <h2 className="text-2xl font-semibold text-white">DeFi Platform</h2>
                  <p className="text-sm leading-relaxed text-white/70">
                    Orchestrate liquidity, staking, and reward pipelines that react in seconds. The DeFi Platform
                    continuously observes wallets, computes risk, and synchronises approvals so human operators stay
                    focused on strategy.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { title: 'Automation uptime', value: '99.982%' },
                  { title: 'Cross-chain latency', value: '~2.1s' },
                  { title: 'Protocols secured', value: '27' },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm shadow-[0_12px_32px_rgba(15,23,42,0.35)]"
                  >
                    <div className="text-[11px] uppercase tracking-[0.25em] text-white/40">{item.title}</div>
                    <div className="mt-1 text-lg font-semibold text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.18)]">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <TelemetrySignup />
          </div>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {NAV_LINKS.map((section) => (
              <nav key={section.heading} className="space-y-3 text-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.35em] text-white/50">
                  {section.heading}
                </div>
                <ul className="space-y-2 text-white/70">
                  {section.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="group inline-flex items-center gap-2 transition hover:text-white"
                      >
                        <span>{link.label}</span>
                        <svg
                          aria-hidden
                          className="h-3.5 w-3.5 -translate-y-px text-white/40 transition group-hover:text-emerald-300"
                          viewBox="0 0 16 16"
                          fill="none"
                        >
                          <path
                            d="M5 3h8v8"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M13 3 3 13"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-6 border-t border-white/10 pt-6 text-xs text-white/60 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/60">
              QA
            </div>
            <div>
              <div className="uppercase tracking-[0.35em]">DeFi Platform Ops</div>
              <div className="text-white/40">Core infrastructure for multi-chain liquidity automation.</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {SOCIAL_LINKS.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-2 text-xs uppercase tracking-[0.3em] text-white/50 transition hover:border-emerald-300/60 hover:text-white"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold text-white/70 group-hover:bg-emerald-400 group-hover:text-black">
                  {social.initials}
                </span>
                {social.label}
                <svg
                  aria-hidden
                  className="h-3 w-3 text-white/40 transition group-hover:text-emerald-300"
                  viewBox="0 0 12 12"
                  fill="none"
                >
                  <path
                    d="M3 9 9 3M9 3H3m6 0v6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            ))}
          </div>
          <div className="flex flex-wrap gap-4 text-[11px] uppercase tracking-[0.3em] text-white/40">
            <span>v1.8.0-alpha</span>
            <span>2025 © DeFi Platform Ops</span>
            <span>Privacy · Terms</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
