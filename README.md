# Train App

An offline workout tracker that installs to the iPhone home screen and behaves
like a native app. No account, no server, no network calls — every workout,
routine and measurement lives in the phone's own storage.

## What it does

- **208 built-in exercises** across barbell, dumbbell, cable, kettlebell,
  bodyweight, machine, band and cardio — plus your own custom ones.
- **Workout generator** — on the Train tab, tick the equipment you have
  (barbell, dumbbell, cable…) and the body areas to hit, pick a goal
  (strength / muscle / endurance) and a time, and it builds a balanced session:
  a compound lift first for each area, no repeated movements, and a preference
  for exercises you haven't done lately. Swap (⇄) any exercise for a similar
  one, add more, edit sets and reps, or randomize the whole thing — then start
  it or save it as a routine. Runs entirely on the phone, free.
- **Swap mid-workout** — ⋯ on any exercise → *Swap for a similar exercise*.
- **Routines** — pick exercises, set targets (sets × reps), reorder them, save.
  Start one with a single tap and the whole session is pre-filled.
- **Set logging** — weight and reps per set, with last session's numbers shown
  as placeholders so you just tap through. Bodyweight moves take added weight;
  planks and carries log seconds; cardio logs minutes and distance.
- **Animations** — every exercise has an animated figure showing the movement,
  the equipment and the bench/rack/cable it uses.
- **Rest timer** — starts automatically when you tick a set, with a countdown
  ring, ±15s and a chime.
- **History** — every finished session, with a per-exercise breakdown.
- **Progress** — weekly volume, sets per muscle group, per-exercise strength
  curves (estimated 1RM vs top set), bodyweight trend, PR detection.
- **Body metrics** — height, weight log over time, BMI.

## Getting it onto the iPhone

The app must be served over **HTTPS** (or `localhost`). That is an iOS
requirement for service workers, not a choice this app makes — without it there
is no offline mode. GitHub Pages is the recommended host: free, permanent, and
the URL never expires.

### Step 1 — Create the repository

1. Sign in at <https://github.com> (create an account if you need one).
2. Click **+ → New repository**.
3. Name it `laurens-app`. **Choose Public** — GitHub Pages on a private repo
   requires a paid plan, and there is nothing private in here: your workouts
   live on the phone, never in the repo.
4. Do **not** tick "Add a README" — this folder already has one.
5. **Create repository**.

### Step 2 — Upload the files

On the empty repo page, click **uploading an existing file**.

Every file sits at the top level — there are deliberately **no subfolders**,
because GitHub's "choose your files" picker cannot select folders and silently
leaves them behind.

Open `LaurensWorkouts` in File Explorer, press **Ctrl+A** to select everything,
and drag it onto the GitHub upload area (or use "choose your files", which now
works too). Wait until all 15 files are listed, then **Commit changes**.

The repo root must end up looking like this — `index.html` at the top level,
no folder wrapping it:

```
index.html   manifest.json   sw.js   README.md
app.css      app.js   store.js   exercises.js   anim.js   charts.js
generator.js
icon-192.png   icon-512.png   apple-touch-icon.png
.nojekyll    .gitignore
```

If `.nojekyll` will not upload (Explorer hides dot-files under some settings),
add it by hand: **Add file → Create new file**, type `.nojekyll` as the name,
leave it empty, commit. It stops GitHub's Jekyll processor from interfering.
`.gitignore` is optional — the app runs without it.

### Step 3 — Switch Pages on

**Settings → Pages → Source: Deploy from a branch → Branch: `main`, folder
`/ (root)` → Save.**

Wait a minute or two, refresh, and the URL appears at the top:
`https://<your-username>.github.io/laurens-app/`

### Step 4 — Check it on the computer first

Open that URL in any browser. You should see the dark **Train App** screen.
A 404 usually just means Pages has not finished building — wait a minute and
retry before changing anything.

### Step 5 — Install it on the iPhone

1. Open **Safari** on the iPhone. It must be Safari — other browsers cannot
   install to the home screen properly.
2. Go to the URL from step 3.
3. **Let it load fully** while on Wi-Fi. This is the moment the offline cache
   is written.
4. Tap the **Share** button (the square with an arrow, bottom centre).
5. Scroll down and tap **Add to Home Screen**.
6. Leave the name as "Train App" and tap **Add**.

### Step 6 — Prove offline mode works

1. Tap the new icon. Let it sit for about five seconds, still on Wi-Fi.
2. Close it, turn on **Aeroplane Mode**, and open the icon again.

If the app loads with no connection, offline mode is locked in. If it does not,
go back to step 5 and give it longer on Wi-Fi before adding it.

### Step 7 — First-run setup

Tap **☰** (top right) and set your height, weight unit, and today's bodyweight,
then **Save**. That switches on BMI and the bodyweight chart.

### Testing on the computer first

```
cd LaurensWorkouts
python -m http.server 5173
```

Then open <http://127.0.0.1:5173/index.html>. Opening `index.html` directly as a
`file://` URL will **not** work — the app uses JavaScript modules, which
browsers only load over http/https.

## Keeping it working — the short list

1. **Always launch from the home screen icon**, never from Safari. That is what
   gives you full-screen mode and the more durable storage.
2. **Never use Settings → Safari → Clear History and Website Data.** It erases
   your workout history along with everything else. To tidy Safari, remove
   individual sites under **Settings → Safari → Advanced → Website Data**.
3. **Do not delete the home screen icon.** Removing it removes its data.
4. **Never open the site in a Private tab** — nothing saves there.
5. **Export a backup every month or so** (☰ → Export backup). It saves a JSON
   file to Files; keep one in iCloud Drive. This is the only real protection
   against a lost or wiped phone.
6. **If you rename the repo**, the URL changes and the old icon stops working —
   delete the icon and re-add it from the new URL.

## About your data

Everything is in `localStorage` under the key `ironlog_v2`, on the phone only.
(That key keeps its original name deliberately — renaming it would orphan any
history already saved on a phone.)

Two things to know:

- Clearing Safari's website data, or deleting the home-screen app, deletes your
  history with it.
- iOS can evict storage for sites you haven't opened in a while. Adding it to
  the home screen and using it regularly avoids this.

So: **use ☰ → Export backup** now and then. It downloads a JSON file you can
re-import on a new phone via **Import backup**. If you used the earlier version
of this app, its history is imported automatically the first time you open this
one.

## About the animations

They are original, drawn by this app in SVG and released as public domain
(CC0) — no third-party asset, no licence to attribute, nothing fetched from a
CDN that could go offline or change. `anim.js` holds an articulated figure
posed by a two-link inverse-kinematics solver: each of the 74 movement patterns
is a handful of key poses giving hip, hand and foot positions, and the solver
fills in the elbows and knees. That is why feet stay planted on the floor and
hands stay on the bar in every position.

## Files

Everything is at the top level — no subfolders, so the whole app uploads to a
static host in one go.

| Path | Purpose |
|---|---|
| `index.html` | App shell |
| `app.css` | All styling |
| `app.js` | Views, routing, interaction |
| `store.js` | Persistence, stats, PR maths |
| `exercises.js` | The exercise catalogue |
| `anim.js` | Animation engine and movement patterns |
| `charts.js` | SVG charts |
| `generator.js` | Workout generator engine |
| `sw.js` | Service worker (offline cache) |
| `.nojekyll` | Stops GitHub Pages running Jekyll over the files |

### Changing things

- **Add an exercise permanently:** add an entry to `EXERCISES` in
  `exercises.js`. `pattern` must name one of the patterns in `anim.js`.
  (You can also add one from inside the app: **Library → Create custom
  exercise**.)
- **After editing any file:** bump `CACHE` in `sw.js` (e.g. `train-app-v5`),
  re-upload, then open the app on the phone **twice**. The first launch serves
  the old cached copy while quietly fetching the new one; the second shows it.
  Skipping the version bump is why an update can appear to do nothing.

## Chart colours

The charts use slots 1–3 of a colourblind-safe categorical palette, validated
against this app's card surface for lightness band, chroma floor, all-pairs
CVD separation, normal-vision separation and 3:1 contrast. If you change
`--viz-1/2/3` in `app.css`, re-validate rather than eyeballing it.
