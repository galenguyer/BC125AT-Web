/** Small inline icons, drawn with `currentColor`. */

interface IconProps {
  size?: number
  title?: string
}

function Svg({ size = 16, title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  )
}

export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
    <circle cx="2.5" cy="4" r=".6" fill="currentColor" />
    <circle cx="2.5" cy="8" r=".6" fill="currentColor" />
    <circle cx="2.5" cy="12" r=".6" fill="currentColor" />
  </Svg>
)

export const AntennaIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 8v6" />
    <circle cx="8" cy="7" r="1.2" />
    <path d="M5.2 4.2a4 4 0 0 0 0 5.6M10.8 4.2a4 4 0 0 1 0 5.6M3.1 2.1a7 7 0 0 0 0 9.8M12.9 2.1a7 7 0 0 1 0 9.8" />
  </Svg>
)

export const NoSignIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M3.8 3.8l8.4 8.4" />
  </Svg>
)

export const GearIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </Svg>
)

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11" />
  </Svg>
)

export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 10V2M4.5 5.5L8 2l3.5 3.5M2.5 13.5h11" />
  </Svg>
)

export const CheckCircleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M5.3 8.2l1.8 1.8 3.6-3.8" />
  </Svg>
)

export const WarningIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2l6.5 11.5h-13z" fill="currentColor" stroke="currentColor" strokeWidth="1" />
    <path d="M8 6.5v3" stroke="var(--bg-raised, #fff)" strokeWidth="1.6" />
    <circle cx="8" cy="11.6" r=".8" fill="var(--bg-raised, #fff)" stroke="none" />
  </Svg>
)

export const ErrorIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.2 1.5h5.6l3.7 3.7v5.6l-3.7 3.7H5.2l-3.7-3.7V5.2z" fill="currentColor" stroke="currentColor" strokeWidth="1" />
    <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="var(--bg-raised, #fff)" strokeWidth="1.6" />
  </Svg>
)

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3.2v9.6L12.6 8z" fill="currentColor" />
  </Svg>
)

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3.5v9M11 3.5v9" strokeWidth="2.6" />
  </Svg>
)

export const PauseCircleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M6.5 5.6v4.8M9.5 5.6v4.8" />
  </Svg>
)

export const PlayCircleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M6.6 5.4v5.2L10.6 8z" fill="currentColor" />
  </Svg>
)

export const SpeakerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z" />
    <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.6a6 6 0 0 1 0 8.8" />
  </Svg>
)

export const WaveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.5 8h2l1.5-4 2 8 2-10 2 9 1.5-3h2" />
  </Svg>
)

export const SearchIcon = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 13}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5l3.5 3.5" />
  </Svg>
)

export const EyeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </Svg>
)

export const InspectorIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
    <path d="M10 2.5v11" />
  </Svg>
)

export const SidebarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
    <path d="M6 2.5v11" />
  </Svg>
)

export const ChevronIcon = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 10}>
    <path d="M4 6l4 4 4-4" />
  </Svg>
)

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 10}>
    <path d="M6 4l4 4-4 4" />
  </Svg>
)

export const ArrowDownCircleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.2" fill="currentColor" stroke="none" />
    <path d="M8 4.8v6M5.6 8.6L8 11l2.4-2.4" stroke="var(--yellow, #f7d046)" />
  </Svg>
)

export const CloseIcon = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 12}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
)

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
)

export const MinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8h10" />
  </Svg>
)

export const RadioIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4.5" width="8" height="10" rx="1.5" />
    <path d="M10 4.5V1.5M6 7h4" />
  </Svg>
)
