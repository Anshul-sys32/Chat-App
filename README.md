A direct-message chat app built with Vite, React, Express, Socket.IO, and MySQL.

## Requirements

- Node.js 18 or newer
- MySQL 8 or compatible MySQL server

## MySQL setup

Create the `chatapp` database and configure `chatserver/.env` with a MySQL user and password. The server creates the `users`, `messages`, `chat_groups`, and `group_members` tables at startup. Registration creates active standard accounts.

The checked-out `chatserver/.env` defaults to `localhost:3306`, user `root`, and database `chatapp`. Set `DB_PASSWORD` to the password for your local MySQL user.

Set `chatapp/.env` to the server URL for `VITE_API_URL`, `VITE_SERVER_URL`, and `VITE_SOCKET_URL`. These URLs must be reachable from the browser; `localhost` and a private LAN address refer to the phone itself when the app is opened on Android.

### Test from Android with VS Code port forwarding

Forward both the Vite port (`5174`) and API server port (`5175`) in VS Code. Use the HTTPS forwarded address for port `5175` in the frontend configuration:

```dotenv
VITE_API_URL=https://<your-5175-forwarded-address>
VITE_SERVER_URL=https://<your-5175-forwarded-address>
VITE_SOCKET_URL=https://<your-5175-forwarded-address>
```

For example, if VS Code gives port `5175` the address `https://example-5175.inc1.devtunnels.ms`, use that address for all three values. Restart Vite after changing its environment file. Ensure both forwarded ports are accessible from the phone. The backend tunnel is needed for API requests and Socket.IO; forwarding only port `5174` is not enough. The server currently accepts requests from all origins; because credentialed browser requests cannot use the literal `*` CORS header, it reflects each request's origin.

Video calls require a secure browser context. Use HTTPS when opening the app on Android or another device; an HTTP LAN address (such as `http://192.168...`) does not allow camera and microphone access. Localhost is permitted for development. The browser must also be granted camera and microphone permissions.

The app provides matching dark and light themes. Switch themes from the sun/moon
button in the chat sidebar; the selection is saved in the browser and also applies
to the sign-in and administration pages.

### Android app

The React client is packaged as an Android app with Capacitor. Install Android
Studio with Android SDK Platform 36 and configure `chatapp/.env` with the
production HTTPS API and Socket.IO URLs before building; Android devices cannot
reach a development machine through `localhost`.

```sh
cd chatapp
npm install
npm run android:sync
npm run android:open
```

In Android Studio, build and run the `app` configuration on an emulator or
connected device. `npm run android:sync` builds the React app and copies its web
assets into the native project. Camera and microphone permissions are declared
for video/audio calls. The current Google sign-in uses browser-based Google
Identity Services; Google may block this flow in embedded WebViews, so native
Google sign-in needs a dedicated Android OAuth integration.

### Host on an IPv6 address

The development servers can bind to IPv6 using the settings in `chatapp/.env` and `chatserver/.env`. IPv6 literals in URLs must be enclosed in square brackets. Vite's development server is for development only; it may serve the page but does not ensure the app's API and Socket.IO connections work externally.

For external hosting, build the frontend and serve it from the API server so the app, API, and Socket.IO share one origin and port:

```sh
cd chatapp && npm run build
cd ../chatserver && npm start
```

Then open `http://[IPV6_ADDRESS]:5175`. Forward/allow inbound TCP port `5175` through the host firewall and router/ISP IPv6 firewall. This avoids a separate public route to Vite port `5174`. The address must be assigned to the host and globally reachable from the client network.

These development servers use plain HTTP. Login and chat can work over IPv6 HTTP, but browsers require HTTPS for camera and microphone access, so audio/video calls need a TLS-enabled public origin (typically a reverse proxy with a valid certificate and DNS hostname). Do not expose the Vite development server as a production deployment.

### HTTPS with Caddy and DuckDNS

The root `Caddyfile` configures Caddy to reverse-proxy `xyz.duckdns.org` to the app server on port `5175`. Build the frontend first, then make sure DuckDNS has an AAAA record pointing to this host's public IPv6 address. Caddy is installed as a system service on this machine and imports `/etc/caddy/conf.d/*`; install and activate the site with:

```sh
sudo install -m 0644 Caddyfile /etc/caddy/conf.d/xyz.caddy
sudo systemctl enable --now caddy
```

Allow inbound TCP ports `80` and `443` through the host and router IPv6 firewalls. Caddy will obtain and renew a publicly trusted certificate when DNS resolves to this host and it can complete ACME validation. Then open `https://xyz.duckdns.org`. Keep the app server on port `5175`; Caddy terminates HTTPS and proxies API, page, and Socket.IO/WebRTC signaling traffic to it.

### Chat attachments

Direct and group chats support image, video, audio, and PDF attachments up to
50 MB each (five files per message). The Express backend stores uploads in
`chatserver/uploads` and serves them through the existing Caddy reverse proxy;
back up this directory along with the MySQL database. Keep it on persistent
storage, and share the same directory between app instances if you run more
than one. Profile and group images support JPEG, PNG, GIF, WebP, and AVIF up to
5 MB. Upload URLs are unguessable but publicly retrievable by anyone who has the
URL.

## Run locally

```sh
cd chatserver && npm install && npm run dev
cd chatapp && npm install && npm run dev
```

## Authentication and account administration

Set a private signing key and a Google OAuth 2.0 Web client ID in `chatserver/.env`:

```dotenv
JWT_SECRET=<long-random-secret>
GOOGLE_CLIENT_ID=<google-web-client-id>
```

In Google Cloud, configure the OAuth client as a Web application and add the app's
origins (for example, `http://localhost:5174` and the production HTTPS origin) to
its authorized JavaScript origins. The login page fetches the public client ID from
the server at runtime, so a frontend rebuild is not needed when configuring it.
The server verifies Google's signed credential before issuing the app's JWT. It
stores the verified Google subject, email, display name, and profile image URL on
the corresponding user row. Existing accounts with the same verified email are
linked; subsequent sign-ins resolve by Google's stable subject identifier.

New password and Google accounts are created with `pending` status and cannot sign
in until an administrator approves them. To bootstrap the first administrator,
register the account, then run this statement in the configured MySQL database:

```sql
UPDATE users
SET role = 'admin', status = 'active'
WHERE email = 'admin@example.com';
```

After signing in, administrators can approve, suspend, reactivate, change roles,
or delete accounts from the Admin panel. They can also manage group memberships
and group-level roles from the Admin panel or Groups sidebar. Server-side JWT verification and
current account/role checks protect the API; client-side route restrictions are
only a navigation aid.

Users can edit their username and email from the profile button at the bottom of
the chat sidebar, including uploading or changing their profile image. Images
appear in user lists, group member lists, and conversation headers. Group admins
can change a group's image from its management panel; group images appear in the
group list and conversation header. Changing an existing password requires the
current password; OAuth-only accounts can set a password without one.
Administrators can edit any account's username/email, profile image, or set a
replacement password from the Admin panel.
Passwords are hashed before storage and are never returned by profile endpoints.

Administrators can send persistent notifications to all active users or selected
users from the Administration page. Users receive them in the chat header's
notification inbox; unread notifications remain available after reconnecting.
Administrators can also add, edit, and remove the rotating quotes shown beneath
NFaNG on the sign-in page. The dark theme uses a near-black grid background and
a pointer-following glow; light mode remains available from the chat sidebar.

On startup, the server migrates existing message tables to add `is_deleted` and
attachment metadata columns, makes usernames unique, converts legacy inactive
accounts to suspended, and permits OAuth-only accounts without passwords.
