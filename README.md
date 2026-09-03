# 🍬 Candy Trace

> Turn product photography into precise, 1-bit technical line art using the Google Gemini API.

Candy Trace is a local-first workspace for producing clean, consistent, style-matched line art
from photographs at scale. It runs as a web app or as a native macOS app, keeps all your data on
your own machine, and talks directly to Google's Gemini API with a key you supply.

**Status: proof of concept.** It works end to end, but see [Known limitations](#known-limitations)
before relying on it for production work.

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, go to **Settings → API Key**, and paste a Gemini API key from
[aistudio.google.com/apikey](https://aistudio.google.com/apikey).

The key is stored in your browser's local storage on that device only. It is never committed,
never bundled, and never sent anywhere except to Google's API.

> **Image generation needs a paid Google Cloud project.** The Gemini free tier has no quota for
> `gemini-2.5-flash-image`, so trace generation returns HTTP 429 on a free key. Shape
> classification (`gemini-2.5-flash`) does work on the free tier.

---

## Native macOS app

```bash
npm run app:build
```

Produces `Candy Trace.app` and a `.dmg` in `src-tauri/target/release/bundle/`.

Requires [Rust](https://rustup.rs) and Xcode command line tools. For development with hot reload:

```bash
npm run app:dev
```

The bundle is **not code-signed**. On first launch macOS will block it; right-click the app and
choose *Open*, or run `xattr -dr com.apple.quarantine "/Applications/Candy Trace.app"`. To
distribute it properly you need an Apple Developer ID certificate and notarization.

---

## How it works

Candy Trace is organised around a linear workflow, one view per stage:

| View | What it does |
| --- | --- |
| **Dashboard** | Overview of libraries, queue state and recent activity |
| **Candy Library** | Upload source photos; auto-classify each item into a shape bucket |
| **Style Library** | Curate photo + hand-made trace pairs that teach the AI your line style |
| **Work Queue** | Configure and run batch jobs; auto-match candies to styles |
| **Trace Archive** | Searchable archive of every generated trace |
| **Approved Library** | Traces you have marked production-ready; batch-export as ZIP |
| **Sandbox** | Multi-turn chat interface for prompt engineering and one-off generations |

**Typical run:** upload style references → upload candy photos → send to Work Queue →
Auto-Match Styles → Start Processing → review and approve → export from Approved Library.

### Models used

| Task | Model |
| --- | --- |
| Line-art generation | `gemini-2.5-flash-image` |
| Shape classification, side comparison | `gemini-2.5-flash` |

Both are set in `services/geminiService.ts` and `constants.ts`.

---

## File naming convention

Automatic parsing depends on these patterns.

**Candy photos** — filename ends with the side marker:

```
MyPill_A.jpg        CoolCandy_front.png
[Name]_[A|B|1|2|front|back].[jpg|png|webp]
```

**Style files** — a photo plus its corresponding hand-made trace:

```
ThickContour_A.jpg          ← the photo
ThickContour_trace_A.png    ← the 1-bit trace
[Name]_[A|B].[jpg|png|webp]
[Name]_trace_[A|B].png
```

---

## Data & storage

Everything is local-first:

- **IndexedDB** holds libraries, work sessions, the trace archive and settings.
- **Local snapshots** let you save and restore named workspace states.
- **Google Cloud Storage sync** is optional, off by default, and configured under
  *Settings → Data & Backups*.
- The generation prompt is embedded in each output PNG's metadata for traceability.

Clearing browser site data deletes your libraries. Take a snapshot before you do.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 19, TypeScript, Tailwind CSS 3 |
| Build | Vite 6 |
| Desktop shell | Tauri 2 |
| AI | Google Gemini via `@google/genai` |
| Local storage | IndexedDB via `idb` |

---

## Known limitations

These are real and known, not hidden:

- **No code signing.** The macOS bundle triggers Gatekeeper on first launch.
- **Large libraries render eagerly.** Several hundred items in one view will be slow; there is no
  list virtualization yet.
- **Batch processing is not resumable.** Closing the window mid-batch loses in-flight progress.
- **Single JS bundle (~980 kB).** No code splitting yet.
- **`classificationCache.ts`** ships a large table of pre-computed classification results keyed by
  file hash. It speeds up repeat runs on the original dataset and is inert for new images.
- **UI is English only.**

---

## Development

```bash
npm run dev         # Vite dev server on :3000
npm run build       # production web build → dist/
npm run typecheck   # tsc --noEmit
npm run app:dev     # Tauri dev with hot reload
npm run app:build   # macOS .app + .dmg
```

`.env` is optional and only useful locally — see `.env.example`. Never set `GEMINI_API_KEY` for a
build you intend to distribute: Vite inlines the value into the JavaScript bundle, so every user
of that build would receive your key.

---

## License

MIT — see [LICENSE](LICENSE).
