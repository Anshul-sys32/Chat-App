# Feature Expansion Audit and Checklist

Status values: Not started, In progress, Implemented, Tested, Blocked.

## Existing Architecture

- Frontend: React 19 and Vite, with the authenticated chat experience in `chatapp/src/App.jsx` and `chatapp/src/components/Chat.jsx`.
- Backend: Express 5 API in `chatserver/routes/authRoutes.js`, startup in `chatserver/server.js`, and MySQL access through `mysql2/promise` in `chatserver/config/db.js`.
- Realtime: Socket.IO authenticates users and handles direct/group message persistence, message delivery, group rooms, and WebRTC signaling in `chatserver/sockets/socket.js`.
- Authentication: JWT middleware, email verification and reset flows, Google login, account status checks, and admin authorization are already present. Preserve these boundaries.
- Files: Multer stores uploads on local disk. The upload API checks the target conversation and the socket handler checks file ownership and presence. `/uploads` is currently served as static public content, so URLs are not private attachment authorization.
- Mobile: Capacitor packages the same Vite web app. Android native project and audio-routing plugin exist. The Capacitor WebView bridge maps `getUserMedia` capture requests to runtime microphone/camera permission prompts; Android packaging passes, while physical-device media verification remains open.
- Android microphone permissions: `AndroidManifest.xml` declares `RECORD_AUDIO` and `CAMERA`; the installed Capacitor `BridgeWebChromeClient` requests Android runtime permissions when WebView `getUserMedia` is initiated. The voice recorder requests capture only after the user presses Start, so this existing bridge handles the native permission prompt without a duplicate plugin.
- Database: `connectDB()` retains the existing idempotent startup DDL for compatibility. A separate ordered migration runner and ledger now apply new schema changes after that initializer; a live database migration has not yet been run in this work session.
- Tests: Frontend has build and lint scripts but no test framework. Backend uses Node's built-in test runner, currently covering notification preferences and migration behavior without a live MySQL server.

## Relevant Existing Functionality

- Direct and group messages, pagination, replies, unread state, attachments, stickers, message deletion, and group membership are implemented.
- Audio MIME types are accepted by the generic upload pipeline, stored in the `attachments` JSON field, and rendered with native `<audio controls>`.
- In-app notifications are persisted, delivered over Socket.IO, and can be marked read. Current event producers are administrator broadcasts. Browser-notification and sound preferences now persist, but browser push/service worker delivery and other notification categories are not implemented.
- Audio/video calls use browser WebRTC with Socket.IO offer/answer/ICE/hangup signaling. Existing call history supports initiated/completed/missed/declined statuses, but multi-party calls and robust lifecycle coordination are absent. A public STUN server is configured in the client; no TURN configuration or SFU integration exists.
- Profiles, themes, group role administration, call history, and local sticker preferences exist. There is no unified settings model or dedicated meetings/community domain.

## Gaps, Risks, and Decisions

- Existing upload URLs are publicly retrievable. New private voice media is stored outside the static upload tree and fetched only through authenticated message-membership checks.
- The first voice slice adds recording controls, duration metadata, server duration limits, and protected playback. Custom playback speed and waveform/progress controls remain, and end-to-end browser/device verification has not yet been done.
- Message notifications now cover direct and group messages with persisted categories, unique source-message deduplication, and conversation targets. Call/meeting/community producers, per-channel settings, browser push delivery, and notification delivery records remain.
- Group membership currently has only admin/member roles. Community channels, post permissions, moderation, voting, and searchable structured content need backend-enforced capabilities, not client-only checks.
- Meetings need new persistent models, authorization, timezone handling, invitation state, and an idempotent background job. There is no scheduler or queue dependency configured.
- Multi-party WebRTC mesh does not scale reliably. An SFU (for example, LiveKit) needs deployment and credentials; it should be chosen and configured before claiming conferencing is complete.
- CORS and deployment configuration should be rechecked before adding notification/media origins. No new external service is assumed for the initial slice.

## Data, API, and Realtime Plan

- Migration strategy: ordered, additive JavaScript migrations use a `schema_migrations` ledger and a MySQL advisory lock. They run after the legacy startup initializer and can also be applied with `npm --prefix chatserver run db:migrate`; do not rebuild or drop existing tables. Migration execution against the configured database must be performed only after confirming the environment points to the intended database.
- Voice messages reuse the existing message attachment representation. New recordings are stored in a private directory with a membership-checked range-capable media route. Duration, byte size, MIME, and sender-owned filename are validated.
- Preferences/notifications: validated user-level browser/sound/direct/group preferences now reuse the existing notification table and `notification` Socket.IO event. Message targets and source IDs are stored for navigation and deduplication.
- Calls/meetings/communities: add separate domain tables and REST services for durable operations, then use authenticated Socket.IO events for state changes after shared service authorization.
- Event names should follow current kebab-case conventions and be scoped to authenticated user or authorized group rooms. Do not broadcast private data globally.

## Dependencies and Configuration

- `MediaRecorder` and browser APIs provide capture; `music-metadata` parses uploaded audio duration server-side and is pinned to a Node 18-compatible release line.
- Markdown rendering/highlighting, push delivery, job scheduling, and SFU dependencies should be selected only when their corresponding phase starts and should be documented with operational requirements.
- Voice deployment settings: `MAX_VOICE_MESSAGE_SECONDS` defaults to 300 and is capped at 3600; `MAX_VOICE_MESSAGE_SIZE_BYTES` defaults to 20 MiB and cannot exceed the existing 50 MiB upload cap. Set `VITE_MAX_VOICE_MESSAGE_SECONDS` to the same duration in the frontend build so the recorder stops at the server limit.
- TURN credentials and SFU secrets must remain server-side. Browser notification permission must be user-initiated; Android notification behavior requires native-device verification.

## Implementation Order and Acceptance Criteria

1. Foundation and audit: preserve current schema/data, add versioned migrations before schema-dependent features, and establish executable backend test coverage. Acceptance: migration apply is additive/idempotent and existing build/auth/message paths remain intact.
2. Preferences and notifications: validate persisted preferences; extend the existing notification center with categorized events and settings. Acceptance: preferences survive reload, read state is user-scoped, events are deduplicated and authorized.
3. Voice messages: add record/pause/resume/cancel/preview/send, then protected media delivery and playback controls. Acceptance: direct and group history persist and render recordings, limits are enforced server-side, membership controls playback, and recording errors are actionable.
4. Group types and communities: centralize capabilities, add channels and structured posts, enforce roles server-side, sanitize Markdown, and add moderation/discovery. Acceptance: unauthorized channel/post operations fail and voting constraints prevent duplicate votes.
5. Conferencing: choose/deploy SFU or explicitly limit mesh to small calls; implement invitations and lifecycle authorization. Acceptance: participant state is consistent, rooms are access-controlled, and real connectivity is tested separately from mocks.
6. Meetings: add UTC persistence with intended timezone, invitations, lifecycle authorization, and idempotent background reminders. Acceptance: DST/timezone cases and reminder retries do not duplicate deliveries.
7. Integration and hardening: run existing and newly added tests/builds, verify Android-specific behavior, update deployment configuration/docs, and report unverified infrastructure honestly.

## Implemented Slice: Voice Recording Foundation

- `POST /api/voice-uploads` accepts one authenticated audio file plus a direct/group target, verifies current conversation access, checks MIME and byte limits, parses actual audio duration, and stores the file outside the public static tree.
- `GET /api/voice-media/:filename` requires the existing authenticated session and verifies the caller can still view a referencing direct or group message. Direct-message hides and deleted messages are denied. Express serves the protected file with private caching headers and supports media range requests.
- No new Socket.IO event was introduced. The existing `send-message` and `group-message` events persist the private voice URL in the established attachment JSON and return its duration metadata.
- A six-hour cleanup pass removes unreferenced private recordings older than 24 hours; message deletion is reflected by cleanup.
- No database schema change or migration was needed for this slice.
- Android packaging: `npm --prefix chatapp run android:sync` and `cd chatapp/android && ./gradlew assembleDebug` both succeeded. This verifies packaging/compilation only, not microphone capture or playback on a physical Android device.
- Private voice messages now use a streaming media element with play/pause, seekable waveform-like progress, 1x/1.5x/2x speed, duration display, loading state, and retryable playback errors. Generic audio attachments retain native controls. End-to-end HTTP/database tests and Android device playback remain unverified.

## Implemented Slice: Migration And Notification Preferences

- `GET /api/notifications/preferences` reads preferences for the authenticated user and returns disabled defaults when no row exists.
- `PATCH /api/notifications/preferences` accepts only `browserNotifications` and `notificationSounds` boolean fields; values are stored per user in `user_notification_preferences`.
- The notification center requests browser-notification permission only after a user enables the setting, displays supported browser alerts only while the app tab is hidden, and plays a generated previewable tone only when enabled. Admin, direct-message, and group-message events are supported; call, meeting, and community producers are not yet wired.
- Closed-app delivery is not implemented. Android native notification behavior is not claimed by the browser Notification API integration.
- Message notifications are created after successful direct/group message persistence, use only active direct recipients/current active group members with the corresponding preference enabled, persist through the existing notification table, and emit to recipient-specific Socket.IO rooms.
- Notification history and realtime payloads include category and optional target metadata. Selecting an in-app or browser notification opens the direct conversation or group.
- The second additive migration adds direct/group preference flags, notification category/target/source fields, and a unique `(user_id, category, source_message_id)` key. Existing administrative notifications remain `system` notifications through the migration default.
- `GET/PATCH /api/conversations/:type/:id/notification-preferences` reads or changes a user-scoped mute flag after verifying direct conversation availability or current group membership. Muted recipients still receive messages but no persistent notification.
- The third additive migration creates `conversation_notification_preferences` with a user/type/conversation composite key. Notification recipient queries exclude muted conversations before persistence and realtime delivery.
- Migration runner, preference controllers, and direct/group notification behavior have ten database-mocked unit tests. The migrations have not been applied to a live MySQL database in this work session.

## Implemented Slice: Media Device Settings

- Sidebar Settings now includes microphone, camera, and speaker selectors. Device IDs are stored locally per authenticated user; device labels are refreshed after user-initiated capture permission.
- Microphone testing uses a live level meter and releases the stream when stopped or when the settings panel closes. Camera preview also stops its stream on close.
- Saved microphone/camera IDs are applied as `ideal` WebRTC and voice-recording constraints so unavailable devices fall back to platform defaults. Saved speaker routes reuse the existing browser/Capacitor audio-routing abstraction on calls.
- Device selection has build/lint coverage only; real browser and Android device switching still need manual verification.

## Feature Checklist

| Feature | Status | Notes |
|---|---|---|
| Repository architecture audit | Implemented | Verified entry points, persistence, uploads, realtime, Capacitor, scripts, and test gaps. |
| Feature implementation document | Implemented | This tracked file records current decisions and acceptance criteria. |
| Versioned database migration foundation | In progress | Ordered ledger/lock runner, three additive migrations, explicit command, and rollback functions exist; live database application remains unverified. |
| Persistent user and conversation settings | In progress | Browser/sound/direct/group preferences, per-chat mute, and device-local microphone/camera/speaker preferences exist; broader profile/privacy/chat settings remain. |
| Categorized notifications and notification preferences | In progress | Direct/group message alerts, opt-outs, deduplication, and navigation are implemented; call/meeting/community producers and push delivery remain. |
| Voice recording, preview, and message integration | In progress | Direct/group attachment-backed persistence and UI are coded; browser/device behavior and end-to-end send are not yet tested. |
| Protected voice storage, duration validation, playback, and cleanup | In progress | Private disk path, parser-based duration check, authenticated message-membership route, cleanup, and custom streaming playback controls are coded; integration/Android device tests remain. |
| Typed groups, channels, and community content | Not started | Requires centralized capabilities and server-side policies. |
| Multi-party calling and participant invitations | Not started | Existing implementation is direct-call signaling; SFU choice/deployment is unresolved. |
| Scheduled meetings and reminders | Not started | No meeting schema, scheduler, or queue currently exists. |
| Automated backend/frontend test coverage | In progress | Backend now runs ten built-in Node tests for preferences, migrations, mute authorization, and message notification delivery; live database integration and frontend interaction tests remain. |
| Android feature verification | In progress | Capacitor sync and Gradle debug APK build pass; microphone permission, recording, and protected playback still need emulator/device testing. |
