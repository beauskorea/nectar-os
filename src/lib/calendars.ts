export type CalendarMeta = {
  key: string;
  label: string;
  // Tailwind classes
  chipBg: string;
  chipText: string;
  dotBg: string;
};

export const CALENDARS: Record<string, CalendarMeta> = {
  beauskorea: {
    key: "beauskorea",
    label: "Jinho Park",
    chipBg: "bg-sky-700/70",
    chipText: "text-sky-50",
    dotBg: "bg-sky-400",
  },
  beautysketch: {
    key: "beautysketch",
    label: "beautysketchkorea",
    chipBg: "bg-amber-700/70",
    chipText: "text-amber-50",
    dotBg: "bg-amber-400",
  },
  beauscontents: {
    key: "beauscontents",
    label: "beauscontents",
    chipBg: "bg-cyan-700/70",
    chipText: "text-cyan-50",
    dotBg: "bg-cyan-400",
  },
  holiday: {
    key: "holiday",
    label: "대한민국 휴일",
    chipBg: "bg-rose-700/70",
    chipText: "text-rose-50",
    dotBg: "bg-rose-400",
  },
  quick: {
    key: "quick",
    label: "Quick (AI)",
    chipBg: "bg-violet-700/70",
    chipText: "text-violet-50",
    dotBg: "bg-violet-400",
  },
};

export const CAL_ORDER: string[] = ["beauskorea", "beautysketch", "beauscontents", "holiday", "quick"];

export type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  cal: string;
};
