# CChat

Real-time messaging backend built with Node.js, Express, Socket.IO, MongoDB, and Cloudinary, paired with a native Raylib desktop client (`CChat-Desktop`).

## Project Structure

- `server.js` — Express + Socket.IO API server (auth, threads, messages, replies, soft deletion, avatars, media uploads, GIPHY search)
- `package.json` / `package-lock.json` — Node.js backend manifest and lockfile (Node `>=20`)
- `test/server.test.js` — Automated unit and HTTP API integration tests using `node:test`
- `CChat-Desktop/` — Native C desktop client (`main.c`, `Makefile`, and macOS bundle `CChat.app`)
- `.env.example` — Environment variable template

## Backend Setup

### Prerequisites

- Node.js `>=20`
- MongoDB connection URI
- Cloudinary credentials (optional for text chat; required for avatar and media upload endpoints)
- GIPHY API key (optional; enables `/api/gifs/search`)

### Installation & Running

```bash
npm install
cp .env.example .env
# Edit .env with your MONGO_URI and optional Cloudinary / GIPHY keys
npm start
```

### Verification & Tests

```bash
npm run check   # Syntax check (node --check server.js)
npm test        # Run unit and API tests (node --test test/*.test.js)
```

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `10000` | HTTP/Socket.IO listen port |
| `MONGO_URI` | Yes (at runtime) | — | MongoDB connection string |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin(s), comma-separated or `*` |
| `CLOUDINARY_CLOUD_NAME` | For media/avatars | — | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | For media/avatars | — | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | For media/avatars | — | Cloudinary API secret |
| `GIPHY_API_KEY` | For GIF search | — | GIPHY API key |

## API Overview

### Health & Info
- `GET /` — Service metadata (`name`, `status`, `version`)
- `GET /api/health` — MongoDB, Cloudinary, and GIPHY readiness status

### Auth & Users
- `POST /api/register` — Register user (`{ username, email, password }`)
- `POST /api/login` — Authenticate user (`{ email, password }`)
- `GET /api/users/search?q=...` — Case-insensitive user search by username or email

### Threads & Messages
- `GET /api/threads/:email` — List threads for a participant email
- `POST /api/threads/create` — Create a 1:1 or group thread (`{ participants, isGroup, groupName }`)
- `GET /api/threads/:threadId/messages` — List messages in a thread
- `POST /api/messages/send` — Send a message (`{ threadId, senderEmail, text, type, attachment, replyTo }`)
- `POST /api/messages/:id/reply` — Reply to an existing message
- `DELETE /api/messages/:id` — Soft-delete your own message (`{ senderEmail }`)

### Avatars, Media & GIFs
- `POST /api/profile/avatar` — Upload raster avatar (`multipart/form-data`: `email`, `avatar`, max 10 MB)
- `DELETE /api/profile/avatar` — Remove user avatar (`{ email }` or `?email=...`)
- `POST /api/uploads` — Upload chat attachment (`multipart/form-data`: `email`, `file`, max 50 MB)
- `DELETE /api/uploads/:publicId` — Delete an uploaded attachment under `cchat/attachments/`
- `GET /api/gifs/search?q=...&limit=...` — Search GIPHY GIFs

### Socket.IO Events
- Client -> Server: `join_thread`, `leave_thread`, `join_user`, `typing`
- Server -> Client: `chat_message`, `thread_updated`, `message_deleted`, `user_updated`, `typing`

## CChat-Desktop

The desktop client in `CChat-Desktop/main.c` uses [raylib](https://www.raylib.com/) and `libcurl`.

### Build from Source

```bash
make -C CChat-Desktop
CCHAT_API_URL=http://localhost:10000 ./CChat-Desktop/cchat-desktop
```

By default, `CChat-Desktop` targets `https://cchat-backend-002b.onrender.com` unless `CCHAT_API_URL` is set.
