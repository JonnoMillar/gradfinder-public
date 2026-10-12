/**
 * Who gradfinder works for. Apply/Research runs (lib/runs/launch.ts) and the Kit page (lib/kit.ts) read this.
 * Fill it in before your first Apply run.
 */
export const USER: {
  /** First name: what runs call you, and the name on answers you give on the Kit page. */
  name: string;
  /** The voice guide a run reads before drafting any free-text answer (absolute, or relative to the project). */
  voiceGuide: string;
  /** The CV in profile/cv/ that every Apply run uploads. `CV_FILE` overrides it (demo mode). */
  cvFile: string;
  /** Jobs runs must never touch: applications you handle entirely by hand. */
  protectedJobs: { id: number; label: string }[];
} = {
  name: "the user",
  voiceGuide: "profile/voice/VOICE.md",
  cvFile: "CV.pdf",
  protectedJobs: [],
};
