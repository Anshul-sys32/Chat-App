A direct-message chat app built with Vite, React, Express, Socket.IO, and MySQL.

## Requirements

- Node.js 18 or newer
- MySQL 8 or compatible MySQL server

## MySQL setup

Create the `chatapp` database and configure `chatserver/.env` with a MySQL user and password. The server creates the `users`, `messages`, `chat_groups`, and `group_members` tables at startup. Registration creates active standard accounts.

The checked-out `chatserver/.env` defaults to `localhost:3306`, user `root`, and database `chatapp`. Set `DB_PASSWORD` to the password for your local MySQL user.

Set `chatapp/.env` to the server URL for `VITE_API_URL`, `VITE_SERVER_URL`, and `VITE_SOCKET_URL`.

## Run locally

```sh
cd chatserver && npm install && npm run dev
cd chatapp && npm install && npm run dev
```
