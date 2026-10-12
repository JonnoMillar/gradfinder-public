/** Icon set for the factfile. 16px grid, stroked, inherits currentColor. Decorative by default. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { label?: string };

function Svg({ label, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={label ? undefined : true} role={label ? "img" : undefined}
      focusable="false" {...rest}
    >
      {label ? <title>{label}</title> : null}
      {children}
    </svg>
  );
}

export const IconCv = (p: P) => (
  <Svg {...p}><path d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5z" /><path d="M9.5 1.5V5H13" /><path d="M5.5 8.5h5M5.5 11h3" /></Svg>
);
export const IconLetter = (p: P) => (
  <Svg {...p}><rect x="1.8" y="3.5" width="12.4" height="9" rx="1" /><path d="m2.2 4.3 5.8 4.2 5.8-4.2" /></Svg>
);
export const IconQuestions = (p: P) => (
  <Svg {...p}><path d="M14 9.5a1 1 0 0 1-1 1H5l-3 2.5v-10a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1z" /><path d="M6.6 5.9a1.5 1.5 0 0 1 2.9.5c0 1-1.5 1.5-1.5 1.5" /><path d="M8 10h.01" /></Svg>
);
export const IconVideo = (p: P) => (
  <Svg {...p}><rect x="1.5" y="4" width="9.5" height="8" rx="1.2" /><path d="m11 8 3.5-2.2v4.4z" /></Svg>
);
export const IconTests = (p: P) => (
  <Svg {...p}><rect x="3" y="2.5" width="10" height="11.5" rx="1" /><path d="M6 1.5h4v2H6z" /><path d="m5.8 8.6 1.4 1.4 3-3.2" /></Svg>
);
export const IconCentre = (p: P) => (
  <Svg {...p}><circle cx="5.6" cy="5.6" r="2.1" /><circle cx="11.2" cy="6.4" r="1.7" /><path d="M1.8 13c0-2.1 1.7-3.5 3.8-3.5s3.8 1.4 3.8 3.5" /><path d="M11 9.6c1.8 0 3.2 1.1 3.2 2.8" /></Svg>
);
export const IconPin = (p: P) => (
  <Svg {...p}><path d="M13 6.8c0 3.6-5 8.2-5 8.2S3 10.4 3 6.8a5 5 0 0 1 10 0" /><circle cx="8" cy="6.7" r="1.9" /></Svg>
);
export const IconPay = (p: P) => (
  <Svg {...p}><path d="M10.3 4.2A3 3 0 0 0 5.6 6.6c0 2.6-.6 4.2-1.9 5.2h8.6" /><path d="M4.4 8.4h4.8" /></Svg>
);
export const IconStart = (p: P) => (
  <Svg {...p}><rect x="2.2" y="3.2" width="11.6" height="11" rx="1.2" /><path d="M2.2 6.6h11.6M5.4 1.8v2.6M10.6 1.8v2.6" /></Svg>
);
export const IconCap = (p: P) => (
  <Svg {...p}><path d="M8 2 1.5 5.4 8 8.8l6.5-3.4z" /><path d="M4.2 7v3.6c0 .9 1.7 1.8 3.8 1.8s3.8-.9 3.8-1.8V7" /></Svg>
);
export const IconMode = (p: P) => (
  <Svg {...p}><rect x="1.6" y="3" width="12.8" height="8.4" rx="1.2" /><path d="M5.4 14h5.2" /></Svg>
);
export const IconVisa = (p: P) => (
  <Svg {...p}><circle cx="8" cy="8" r="6.2" /><path d="M1.8 8h12.4M8 1.8c1.7 1.9 2.6 4 2.6 6.2S9.7 12.3 8 14.2C6.3 12.3 5.4 10.2 5.4 8s.9-4.3 2.6-6.2" /></Svg>
);
export const IconExternal = (p: P) => (
  <Svg {...p}><path d="M6.5 3H3.4A1.4 1.4 0 0 0 2 4.4v8.2A1.4 1.4 0 0 0 3.4 14h8.2a1.4 1.4 0 0 0 1.4-1.4V9.5" /><path d="M9.5 2H14v4.5M14 2 7.6 8.4" /></Svg>
);
export const IconWarn = (p: P) => (
  <Svg {...p}><path d="M7 2.4 1.6 12a1.1 1.1 0 0 0 1 1.7h10.8a1.1 1.1 0 0 0 1-1.7L9 2.4a1.1 1.1 0 0 0-2 0" /><path d="M8 6.3v3M8 11.4h.01" /></Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}><path d="m6 3.5 5 4.5-5 4.5" /></Svg>
);

// ---- role page section icons (same 16px stroked grid)
export const IconBriefcase = (p: P) => (
  <Svg {...p}><rect x="1.8" y="4.5" width="12.4" height="9" rx="1.2" /><path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M1.8 8.5h12.4" /></Svg>
);
export const IconTarget = (p: P) => (
  <Svg {...p}><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="3" /><circle cx="8" cy="8" r=".6" /></Svg>
);
export const IconTrend = (p: P) => (
  <Svg {...p}><path d="M1.5 12.5 6 8l3 3 5.5-6" /><path d="M10.5 5h4v4" /></Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}><circle cx="8" cy="8" r="6.2" /><path d="M8 4.5V8l2.5 1.6" /></Svg>
);
export const IconRoute = (p: P) => (
  <Svg {...p}><circle cx="3.5" cy="12.5" r="1.6" /><circle cx="12.5" cy="3.5" r="1.6" /><path d="M5 12.5h5.5a2 2 0 0 0 0-4h-5a2 2 0 0 1 0-4H11" /></Svg>
);
export const IconSpark = (p: P) => (
  <Svg {...p}><path d="M8 1.8 9.4 6.6 14.2 8 9.4 9.4 8 14.2 6.6 9.4 1.8 8l4.8-1.4z" /></Svg>
);
/** values: a heart */
export const IconHeart = (p: P) => (
  <Svg {...p}><path d="M8 13.6S2 10 2 5.9A3.1 3.1 0 0 1 8 4.6a3.1 3.1 0 0 1 6 1.3C14 10 8 13.6 8 13.6z" /></Svg>
);
export const IconBuilding = (p: P) => (
  <Svg {...p}><rect x="2.5" y="1.8" width="7" height="12.4" rx=".8" /><path d="M9.5 6h3.2a.8.8 0 0 1 .8.8v7.4M4.8 4.5h2.4M4.8 7.3h2.4M4.8 10.1h2.4M1.5 14.2h13" /></Svg>
);
export const IconTrain = (p: P) => (
  <Svg {...p}><rect x="3.5" y="1.8" width="9" height="9.7" rx="2" /><path d="M3.5 7h9M6 9.3h.01M10 9.3h.01M5.5 11.5 4 14.2M10.5 11.5l1.5 2.7" /></Svg>
);
export const IconNews = (p: P) => (
  <Svg {...p}><rect x="1.8" y="2.5" width="12.4" height="11" rx="1" /><path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h4" /></Svg>
);
export const IconChart = (p: P) => (
  <Svg {...p}><path d="M2 14h12" /><rect x="3" y="8" width="2.4" height="6" /><rect x="6.8" y="4.5" width="2.4" height="9.5" /><rect x="10.6" y="2" width="2.4" height="12" /></Svg>
);
export const IconFolder = (p: P) => (
  <Svg {...p}><path d="M1.8 4a1 1 0 0 1 1-1h3.5l1.5 1.8h5.4a1 1 0 0 1 1 1v6.9a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" /></Svg>
);

export const REQ_ICON = {
  cv: IconCv, cover_letter: IconLetter, motivational_questions: IconQuestions,
  video_interview: IconVideo, online_tests: IconTests, assessment_centre: IconCentre,
} as const;
export const IconFilter = (p: P) => (
  <Svg {...p}><path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" /></Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}><circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3.3 3.3" /></Svg>
);
