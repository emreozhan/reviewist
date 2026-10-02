const PATHS = {
  chevronRight: 'M6 3l5 5-5 5',
  chevronDown: 'M3 6l5 5 5-5',
  chevronLeft: 'M10 3L5 8l5 5',
  panelLeft: 'M2 3h12v10H2zM6 3v10',
  panelRight: 'M2 3h12v10H2zM10 3v10',
  search: 'M7 12A5 5 0 107 2a5 5 0 000 10zM11 11l3.5 3.5',
  check: 'M3 8.5l3 3 7-7',
  external: 'M9 3h4v4M13 3L7 9M11 9v4H3V5h4',
  copy: 'M5 5h8v8H5zM3 11V3h8',
  download: 'M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10',
  help: 'M6 6a2 2 0 114 0c0 1.5-2 1.5-2 3M8 11.5v.5',
  sun: 'M8 11a3 3 0 100-6 3 3 0 000 6zM8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3',
  moon: 'M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z',
  auto: 'M8 2a6 6 0 100 12A6 6 0 008 2zM8 2v12M8 5h3M8 8h4M8 11h3',
  graph: 'M3 4h3v3H3zM10 2h3v3h-3zM10 10h3v3h-3zM6 5.5h4M11.5 5v5M6 6l4 5',
  list: 'M5 4h9M5 8h9M5 12h9M2 4h.5M2 8h.5M2 12h.5',
  layers: 'M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3',
  groups: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z',
  flag: 'M3 14V2M3 2h8l-1.5 3L11 8H3',
  arrowUp: 'M8 13V3M4 7l4-4 4 4',
  arrowDown: 'M8 3v10M4 9l4 4 4-4',
  calls: 'M2 8h9M8 5l3 3-3 3M13 3v10',
  close: 'M4 4l8 8M12 4l-8 8',
  expand: 'M8 2v4M8 10v4M5 4l3-2 3 2M5 12l3 2 3-2',
  note: 'M3 2h7l3 3v9H3zM10 2v3h3M5 8h6M5 11h4',
  warning: 'M8 2l6.5 11.5h-13zM8 6.5v3.5M8 11.8v.4',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

/** Tek renkli çizgi ikon seti (16x16 ızgara). Dekoratiftir; anlam metinle verilir. */
export function Icon({ name, size = 14, className }: IconProps) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
