# PayMe

The web app to make them pay.

## Phone notifications

The app uses Web Push: each roommate signs in on their phone and selects **Enable phone alerts**. When a shared expense is logged, every selected person other than the payer receives the amount they owe and who to pay. If the expense remains unpaid after 24 hours, the backend sends one reminder to pay or log the payment.

Set these environment variables on the backend host before deploying:

```text
VAPID_PUBLIC_KEY=<public VAPID key>
VAPID_PRIVATE_KEY=<private VAPID key>
REMINDER_CRON_SECRET=<long random secret>
```

## Persistent ledger storage

Render's local filesystem is temporary, so use Firebase Realtime Database for the shared ledger. In Firebase, create a Realtime Database and generate a service-account private key in **Project settings → Service accounts**. Add these Render environment variables:

```text
FIREBASE_DATABASE_URL=https://<your-database>.firebaseio.com
FIREBASE_SERVICE_ACCOUNT_JSON=<the complete service-account JSON file, on one line>
```

The backend authenticates directly with this service account. Keep Firebase's database rules locked down and never commit the service-account JSON to the repository. When these variables are set, every ledger write goes to Firebase, so future Render deploys use the same transaction history.

Generate the VAPID key pair once from `backend/` with `npx web-push generate-vapid-keys --json`. The app checks reminders every 15 minutes while the server is running. For hosts that sleep inactive web services, schedule a request at least every 15 minutes to `POST /api/push/reminders/run` with header `x-reminder-secret: <REMINDER_CRON_SECRET>` so reminders are not delayed.
