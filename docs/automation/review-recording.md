# Review a practice recording (HireVue, interview)

1. Jonno records his answers on a phone voice memo, saying "Question N" before each. iPhone email attachments over about 20 MB arrive as an Apple Mail Drop: a small `.zip` of `ATT0000x.htm` files, with the audio behind an iCloud link in `ATT00002.htm`.
2. Put the file in `profile/inbox/recordings/` (gitignored). For a Mail Drop zip, read the HTML as text (never open it), take the `data-url`, check it starts with `https://cvws.icloud-content.com/`, and download it with Jonno's go-ahead (state file name and size first).
3. Transcribe: `python scripts/transcribe.py <audio.m4a> --out profile/answers/practice/<date>-<company>-transcript.md` (faster-whisper small.en, cached model only, VAD on; about 20 min of audio took a few minutes on CPU). Run it in the background. Without "Question N" markers the single block needs splitting by content.
4. Review into `profile/answers/practice/<date>-<company>-review.md`: time per answer, facts that contradict the store or Jonno's rules, reflection and value gaps, keep/fix.
5. Facts spoken that are not in the store go to `profile/inbox/transcript-candidates.md` as [PROPOSED]. Jonno approves each; only then do they move to stories.md or facts.yaml as [CONFIRMED].

Gotchas: Whisper drops filler words, so the filler count is a floor. The recording may start mid-answer if recording began late.
