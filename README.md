# 10 words a day — SPM English vocab website

Next.js + Firebase Auth + Firestore, deployed on Vercel. Word content lives
in a Notion database you curate yourself.

## What's already built

- `/` — the daily flip-card page: streak, progress bar, word → definition +
  example, "Got it" / "Review again".
- `/api/words` — server route that pulls your next 10 words from Notion,
  ordered by the `Order` field. Your Notion token never reaches the browser.
- `lib/firebase.js` — Google sign-in + Firestore client.
- `lib/progress.js` — streak logic (increments on consecutive days, resets
  if you miss a day) and per-user word count, stored in Firestore under
  `users/{uid}`.

## 1. Set up your Notion database

Create a database called **Vocab Bank** with these columns (names and types
must match exactly):

| Column        | Type   |
|---------------|--------|
| Word          | Title  |
| Definition    | Text   |
| Example       | Text   |
| Order         | Number |
| Theme         | Select (optional) |
| PartOfSpeech  | Select (optional) |

Give every row an increasing `Order` value (1, 2, 3…) — that's the sequence
users move through. You can add more rows any time; just keep `Order`
increasing.

Then:
1. Go to notion.so/my-integrations → "New integration" → copy the **Internal
   Integration Token**.
2. Open your Vocab Bank database → "..." menu → "Connections" → connect your
   new integration.
3. Copy the database ID from its URL: `notion.so/yourworkspace/DATABASE_ID?v=...`

## 2. Set up Firebase

Reuse your XPLog Firebase project, or create a new one:
1. Firebase console → Authentication → enable Google sign-in.
2. Firestore → create database (production mode is fine — add rules below).
3. Project settings → copy the web app config values.

Firestore rules (users can only read/write their own progress doc):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## 3. Environment variables

Copy `.env.local.example` to `.env.local` and fill in:

```
NOTION_API_KEY=secret_...
NOTION_DATABASE_ID=...
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

## 4. Run locally

```
npm install
npm run dev
```

## 5. Deploy to Vercel

Push this folder to a GitHub repo and import it in Vercel, or use the Vercel
CLI (`vercel`). Add the same environment variables in the Vercel project
settings. Also add your Vercel domain to Firebase Authentication →
Settings → Authorized domains (this is the popup bug you already hit once
with XPLog).

## Not built yet (next steps from our plan)

- Leaderboard (reads `users` collection ordered by `wordsLearnedCount`)
- Essay store + tap-to-define + "add to vocab queue"
- AI essay marking
