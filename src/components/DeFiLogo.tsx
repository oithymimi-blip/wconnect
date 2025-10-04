import type { FC, SVGProps } from 'react'
import clsx from 'clsx'

const SvgLogo: FC<SVGProps<SVGSVGElement>> = ({ className, ...props }) => (
  <svg
    viewBox="0 0 72 72"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={clsx('h-full w-full drop-shadow-[0_12px_28px_rgba(16,204,255,0.35)]', className)}
    {...props}
  >
    <defs>
      <linearGradient id="logo-gradient-a" x1="10" y1="12" x2="62" y2="62" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#38f8b7" />
        <stop offset="1" stopColor="#09a8ff" />
      </linearGradient>
      <radialGradient id="logo-gradient-b" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(36 36) scale(36)">
        <stop offset="0" stopColor="#1f1d52" stopOpacity="0.9" />
        <stop offset="1" stopColor="#030615" stopOpacity="0.4" />
      </radialGradient>
      <linearGradient id="logo-gradient-c" x1="18" y1="16" x2="52" y2="50" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#98f5ff" stopOpacity="0.92" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0.65" />
      </linearGradient>
    </defs>
    <circle cx="36" cy="36" r="32" fill="url(#logo-gradient-b)" opacity="0.9" />
    <path
      d="M20 22c0-1.66 1.34-3 3-3h26c1.66 0 3 1.34 3 3v7.24c0 1.04-0.54 2.02-1.42 2.57l-12.58 7.9a3 3 0 0 0-1.42 2.57v7.37c0 1.47-0.8 2.82-2.09 3.54l-8.82 4.82c-1.98 1.08-4.67-0.32-4.67-2.56V22Z"
      fill="url(#logo-gradient-a)"
      opacity="0.92"
    />
    <path
      d="M29.5 21h12.8c1.57 0 2.85 1.27 2.85 2.85v4.7a2.85 2.85 0 0 1-1.32 2.41l-7.1 4.5a2.85 2.85 0 0 0-1.32 2.41v4.94a2.85 2.85 0 0 1-1.43 2.47l-6.45 3.67c-1.89 1.07-4.28-0.28-4.28-2.47V23.85A2.85 2.85 0 0 1 29.5 21Z"
      fill="url(#logo-gradient-c)"
      opacity="0.9"
    />
    <circle cx="45.5" cy="24.5" r="4.5" fill="#0affde" opacity="0.85" />
    <circle cx="27.5" cy="45.5" r="3.5" fill="#3cc9ff" opacity="0.85" />
    <path
      d="M42 41c4.97 0 9 4.03 9 9 0 0.24-0.01 0.48-0.03 0.71L51 51.5c-0.52 2.86-3.03 4.95-5.93 4.95h-7.22c-1.66 0-3-1.34-3-3v-5.45C37.24 43.88 39.41 41 42 41Z"
      fill="#0d1b42"
      opacity="0.65"
    />
  </svg>
)

export const DeFiLogo: FC<{ className?: string }> = ({ className }) => (
  <div className={clsx('inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-900/60 to-slate-950 p-2 shadow-[0_18px_45px_rgba(11,212,255,0.28)] sm:h-16 sm:w-16', className)}>
    <SvgLogo />
  </div>
)

export default DeFiLogo
