/**
 * Cross-platform SVG icons — works on both react-native and react-native-web.
 * No dependency on @expo/vector-icons, which doesn't exist on web.
 *
 * Each icon accepts { size?, color?, style? } and renders inline SVG.
 */

import { type ReactNode, type SVGProps } from 'react';

interface IconProps {
  size?: number;
  color?: string;
  style?: SVGProps<SVGSVGElement> | any;
}

function SvgWrap({
  size = 24,
  color = '#3a3530',
  children,
  style,
}: IconProps & { children: ReactNode }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {children}
    </svg>
  );
}

export function WindIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
    </SvgWrap>
  );
}

export function BookmarkIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </SvgWrap>
  );
}

export function ChevronDownIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <polyline points="6 9 12 15 18 9" />
    </SvgWrap>
  );
}

export function CheckIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <polyline points="20 6 9 17 4 12" />
    </SvgWrap>
  );
}

export function TrashIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </SvgWrap>
  );
}

export function EditIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </SvgWrap>
  );
}

export function XIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </SvgWrap>
  );
}

export function SearchIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </SvgWrap>
  );
}

export function LibraryIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </SvgWrap>
  );
}

export function ChevronRightIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <polyline points="9 18 15 12 9 6" />
    </SvgWrap>
  );
}

export function SettingsIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1.82V22a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.82-.33H2a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.3l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6A1.65 1.65 0 0 0 10.33 2V2a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.34.35.65.6 1a1.65 1.65 0 0 0 1.82.33H22a2 2 0 1 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z" />
    </SvgWrap>
  );
}

/** Highlighter pen — angled marker tip with a color band. */
export function HighlighterPenIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      {/* Pen body */}
      <path d="M15 3l6 6-10 10H5v-6l10-10z" />
      {/* Color tip band */}
      <path d="M17 5l-9 9" strokeWidth="4" strokeLinecap="butt" opacity="0.5" />
    </SvgWrap>
  );
}
