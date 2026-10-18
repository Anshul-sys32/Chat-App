A direct-message chat app built with Vite, React, Express, Socket.IO, and MySQL.

## Requirements

- Node.js 18 or newer
- MySQL 8 or compatible MySQL server

## MySQL setup

Create the `chatapp` database and configure `chatserver/.env` with a MySQL user and password. The server creates the `users`, `messages`, `chat_groups`, and `group_members` tables at startup. Registration creates active standard accounts.

The checked-out `chatserver/.env` defaults to `localhost:3306`, user `root`, and database `chatapp`. Set `DB_PASSWORD` to the password for your local MySQL user.

Set `chatapp/.env` to the server URL for `VITE_API_URL`, `VITE_SERVER_URL`, and `VITE_SOCKET_URL`. These URLs must be reachable from the browser; `localhost` and a private LAN address refer to the phone itself when the app is opened on Android.

### Test from Android with VS Code port forwarding

Forward both the Vite port (`5173`) and API server port (`5000`) in VS Code. Use the HTTPS forwarded address for port `5000` in the frontend configuration:

```dotenv
VITE_API_URL=https://<your-5000-forwarded-address>
VITE_SERVER_URL=https://<your-5000-forwarded-address>
VITE_SOCKET_URL=https://<your-5000-forwarded-address>
```

For example, if VS Code gives port `5000` the address `https://example-5000.inc1.devtunnels.ms`, use that address for all three values. Restart Vite after changing its environment file. Ensure both forwarded ports are accessible from the phone. The backend tunnel is needed for API requests and Socket.IO; forwarding only port `5173` is not enough. The server currently accepts requests from all origins; because credentialed browser requests cannot use the literal `*` CORS header, it reflects each request's origin.

Video calls require a secure browser context. Use HTTPS when opening the app on Android or another device; an HTTP LAN address (such as `http://192.168...`) does not allow camera and microphone access. Localhost is permitted for development. The browser must also be granted camera and microphone permissions.

## Run locally

```sh
cd chatserver && npm install && npm run dev
cd chatapp && npm install && npm run dev
```
