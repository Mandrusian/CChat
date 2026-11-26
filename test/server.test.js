const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const https = require("node:https");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const cloudinary = require("cloudinary").v2;

const {
    app,
    server,
    io,
    models: { User, Thread, Message },
    helpers
} = require("../server");

let baseUrl = "";

test.before(async () => {
    await new Promise(resolve => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
});

test.after(async () => {
    await new Promise(resolve => {
        io.close(() => resolve());
    });
    if (server.listening) {
        await new Promise(resolve => server.close(resolve));
    }
});

async function requestJson(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, options);
    const text = await res.text();
    let data = null;
    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }
    return { status: res.status, headers: res.headers, data };
}

test("helper functions validate and sanitize inputs", () => {
    assert.equal(helpers.normalizeEmail("  Alice@Example.COM "), "alice@example.com");
    assert.equal(helpers.normalizeEmail({ $ne: null }), "");
    assert.equal(helpers.isValidEmail("alice@example.com"), true);
    assert.equal(helpers.isValidEmail("not-an-email"), false);

    assert.equal(helpers.escapeRegex("a.*+?^${}()|[]\\b"), "a\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\b");

    const oid = new mongoose.Types.ObjectId().toString();
    assert.equal(helpers.isValidObjectId(oid), true);
    assert.equal(helpers.isValidObjectId("invalid-id"), false);

    assert.equal(helpers.isSafeHttpUrl("https://cdn.example.com/a.png"), true);
    assert.equal(helpers.isSafeHttpUrl("http://localhost:8080/a.png"), true);
    assert.equal(helpers.isSafeHttpUrl("javascript:alert(1)"), false);
    assert.equal(helpers.isSafeHttpUrl("data:text/html,<script>alert(1)</script>"), false);

    assert.equal(helpers.sanitizeFilename("../../etc/passwd"), "passwd");
    assert.equal(helpers.sanitizeFilename("..\\..\\evil.exe"), "evil.exe");
    assert.equal(helpers.sanitizeFilename(".."), "file");

    assert.equal(helpers.sanitizePublicId("cchat%2Fattachments%2Fimg_1.png"), "cchat/attachments/img_1.png");
    assert.equal(helpers.sanitizePublicId("cchat%2Fattachments%2F..%2Favatars%2Fme"), null);
    assert.equal(helpers.sanitizePublicId("cchat%2Favatars%2Fme"), null);
    assert.equal(helpers.sanitizePublicId("%E0%A4%A"), null);

    assert.deepEqual(helpers.sanitizeAttachment(null), { attachment: null });
    assert.ok(helpers.sanitizeAttachment({ url: "javascript:alert(1)" }).error);
    const cleanAtt = helpers.sanitizeAttachment({
        url: "https://res.cloudinary.com/demo/image/upload/v1/sample.jpg",
        originalName: "../../secret/photo.jpg",
        size: 1234
    });
    assert.equal(cleanAtt.attachment.originalName, "photo.jpg");
    assert.equal(cleanAtt.attachment.size, 1234);

    assert.equal(helpers.inferMessageType("image/png"), "image");
    assert.equal(helpers.inferMessageType("image/svg+xml"), "file");
    assert.equal(helpers.inferMessageType("video/mp4"), "video");
    assert.equal(helpers.inferMessageType("application/pdf"), "file");

    assert.equal(helpers.parseCorsOrigin("*"), "*");
    assert.deepEqual(helpers.parseCorsOrigin("https://a.com, https://b.com"), ["https://a.com", "https://b.com"]);
});

test("health, root, security headers, 404, and malformed JSON handling", async () => {
    const root = await requestJson("/");
    assert.equal(root.status, 200);
    assert.equal(root.data.name, "CChat Backend");
    assert.equal(root.headers.get("x-content-type-options"), "nosniff");
    assert.equal(root.headers.get("x-frame-options"), "DENY");
    assert.equal(root.headers.get("x-powered-by"), null);

    const health = await requestJson("/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);
    assert.equal(health.data.mongo, "disconnected");

    const notFound = await requestJson("/api/does-not-exist");
    assert.equal(notFound.status, 404);
    assert.equal(notFound.data.error, "Not found");

    const badJson = await requestJson("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json"
    });
    assert.equal(badJson.status, 400);
    assert.equal(badJson.data.error, "Invalid JSON payload");
});

test("POST /api/register validates input, rejects duplicates, and creates users", async t => {
    const missing = await requestJson("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "a@example.com" })
    });
    assert.equal(missing.status, 400);

    const invalidEmail = await requestJson("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "Alice", email: "bad-email", password: "password123" })
    });
    assert.equal(invalidEmail.status, 400);

    const shortPw = await requestJson("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "Alice", email: "alice@example.com", password: "123" })
    });
    assert.equal(shortPw.status, 400);

    const userId = new mongoose.Types.ObjectId();
    let findOneStub = t.mock.method(User, "findOne", async () => ({ _id: userId, email: "alice@example.com" }));
    const dup = await requestJson("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "Alice", email: "alice@example.com", password: "password123" })
    });
    assert.equal(dup.status, 409);
    findOneStub.mock.restore();

    findOneStub = t.mock.method(User, "findOne", async () => null);
    const createStub = t.mock.method(User, "create", async payload => ({
        _id: userId,
        username: payload.username,
        email: payload.email,
        passwordHash: payload.passwordHash,
        avatarUrl: null,
        createdAt: new Date("2026-01-01T00:00:00Z")
    }));

    const created = await requestJson("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "Alice", email: "  ALICE@example.com ", password: "password123" })
    });

    assert.equal(created.status, 201);
    assert.equal(created.data.user.email, "alice@example.com");
    assert.equal(created.data.user.username, "Alice");
    assert.equal("passwordHash" in created.data.user, false);
    assert.equal(createStub.mock.callCount(), 1);
});

test("POST /api/login authenticates valid credentials and rejects bad ones", async t => {
    const missing = await requestJson("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
    });
    assert.equal(missing.status, 400);

    const passwordHash = await bcrypt.hash("secret123", 4);
    const userDoc = {
        _id: new mongoose.Types.ObjectId(),
        username: "Bob",
        email: "bob@example.com",
        passwordHash,
        avatarUrl: null,
        createdAt: new Date("2026-01-01T00:00:00Z")
    };

    t.mock.method(User, "findOne", async ({ email }) => (email === "bob@example.com" ? userDoc : null));

    const wrongPw = await requestJson("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "bob@example.com", password: "wrong" })
    });
    assert.equal(wrongPw.status, 401);

    const ok = await requestJson("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "BOB@example.com", password: "secret123" })
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.user.email, "bob@example.com");
    assert.equal("passwordHash" in ok.data.user, false);
});

test("GET /api/users/search escapes regex metacharacters", async t => {
    const empty = await requestJson("/api/users/search?q=");
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.data, []);

    let capturedFilter = null;
    t.mock.method(User, "find", filter => {
        capturedFilter = filter;
        return {
            select() {
                return {
                    async limit() {
                        return [];
                    }
                };
            }
        };
    });

    const res = await requestJson("/api/users/search?q=" + encodeURIComponent("a.*(b)+?"));
    assert.equal(res.status, 200);
    assert.equal(capturedFilter.$or[0].email.$regex, "a\\.\\*\\(b\\)\\+\\?");
});

test("threads endpoints validate inputs and create/fetch threads", async t => {
    const badEmail = await requestJson("/api/threads/not-an-email");
    assert.equal(badEmail.status, 400);

    const badThreadId = await requestJson("/api/threads/not-an-object-id/messages");
    assert.equal(badThreadId.status, 400);
    assert.equal(badThreadId.data.error, "Invalid thread ID");

    const badParticipants = await requestJson("/api/threads/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participants: "alice@example.com" })
    });
    assert.equal(badParticipants.status, 400);

    const invalidParticipantEmail = await requestJson("/api/threads/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participants: ["alice@example.com", "invalid"] })
    });
    assert.equal(invalidParticipantEmail.status, 400);

    const threadId = new mongoose.Types.ObjectId();
    t.mock.method(Thread, "findOne", async () => null);
    t.mock.method(Thread, "create", async payload => ({
        _id: threadId,
        participants: payload.participants,
        isGroup: payload.isGroup,
        groupName: payload.groupName,
        createdAt: new Date(),
        updatedAt: new Date()
    }));

    const created = await requestJson("/api/threads/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            participants: ["Alice@example.com", "bob@example.com"],
            isGroup: false
        })
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.data.participants, ["alice@example.com", "bob@example.com"]);
});

test("messages send, reply, and delete validate ObjectIds, XSS URLs, ownership, and emit events", async t => {
    const threadId = new mongoose.Types.ObjectId();
    const messageId = new mongoose.Types.ObjectId();
    const replyMessageId = new mongoose.Types.ObjectId();

    const emitted = [];
    t.mock.method(io, "to", room => ({
        emit(event, payload) {
            emitted.push({ room, event, payload });
        }
    }));

    const badThread = await requestJson("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            threadId: "bad-id",
            senderEmail: "alice@example.com",
            text: "hi"
        })
    });
    assert.equal(badThread.status, 400);

    const xssAttachment = await requestJson("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            threadId: threadId.toString(),
            senderEmail: "alice@example.com",
            text: "",
            type: "image",
            attachment: { url: "javascript:alert(1)" }
        })
    });
    assert.equal(xssAttachment.status, 400);

    const threadDoc = {
        _id: threadId,
        participants: ["alice@example.com", "bob@example.com"],
        isGroup: false,
        groupName: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        async save() {
            return this;
        }
    };
    t.mock.method(Thread, "findById", async id => (String(id) === String(threadId) ? threadDoc : null));

    const notMember = await requestJson("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            threadId: threadId.toString(),
            senderEmail: "mallory@example.com",
            text: "intrude"
        })
    });
    assert.equal(notMember.status, 403);

    const storedMessages = new Map();
    t.mock.method(Message, "create", async data => {
        const id = storedMessages.size === 0 ? messageId : replyMessageId;
        const doc = {
            _id: id,
            threadId: data.threadId,
            senderEmail: data.senderEmail,
            text: data.text,
            type: data.type,
            attachment: data.attachment,
            replyTo: data.replyTo || null,
            deleted: false,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            async save() {
                return this;
            }
        };
        storedMessages.set(String(id), doc);
        return doc;
    });

    t.mock.method(Message, "findById", id => {
        const doc = storedMessages.get(String(id)) || null;
        if (!doc) {
            return {
                async populate() {
                    return null;
                },
                then(resolve) {
                    resolve(null);
                }
            };
        }
        return {
            ...doc,
            async populate() {
                if (doc.replyTo && storedMessages.has(String(doc.replyTo))) {
                    return { ...doc, replyTo: storedMessages.get(String(doc.replyTo)) };
                }
                return doc;
            },
            then(resolve) {
                resolve(doc);
            }
        };
    });

    const sent = await requestJson("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            threadId: threadId.toString(),
            senderEmail: "alice@example.com",
            text: "Hello Bob",
            type: "text"
        })
    });
    assert.equal(sent.status, 201);
    assert.equal(sent.data.text, "Hello Bob");
    assert.ok(emitted.some(e => e.room === `thread:${threadId}` && e.event === "chat_message"));
    assert.ok(emitted.some(e => e.room === "user:bob@example.com" && e.event === "thread_updated"));

    emitted.length = 0;
    const replied = await requestJson(`/api/messages/${messageId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            senderEmail: "bob@example.com",
            text: "Hi Alice!"
        })
    });
    assert.equal(replied.status, 201);
    assert.equal(replied.data.replyTo.id, String(messageId));
    assert.ok(emitted.some(e => e.room === `thread:${threadId}` && e.event === "chat_message"));
    assert.ok(emitted.some(e => e.room === "user:alice@example.com" && e.event === "thread_updated"));

    // DELETE without body should return 400, not 500
    const deleteNoBody = await requestJson(`/api/messages/${messageId}`, { method: "DELETE" });
    assert.equal(deleteNoBody.status, 400);

    const deleteWrongUser = await requestJson(`/api/messages/${messageId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderEmail: "bob@example.com" })
    });
    assert.equal(deleteWrongUser.status, 403);

    const deleteOk = await requestJson(`/api/messages/${messageId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderEmail: "alice@example.com" })
    });
    assert.equal(deleteOk.status, 200);
    assert.equal(deleteOk.data.deleted, true);
    assert.equal(deleteOk.data.text, "");
});

test("upload, avatar, and upload deletion enforce Cloudinary config, MIME/size limits, and path safety", async t => {
    const prevEnv = {
        name: process.env.CLOUDINARY_CLOUD_NAME,
        key: process.env.CLOUDINARY_API_KEY,
        secret: process.env.CLOUDINARY_API_SECRET
    };

    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;

    t.after(() => {
        if (prevEnv.name !== undefined) process.env.CLOUDINARY_CLOUD_NAME = prevEnv.name;
        else delete process.env.CLOUDINARY_CLOUD_NAME;
        if (prevEnv.key !== undefined) process.env.CLOUDINARY_API_KEY = prevEnv.key;
        else delete process.env.CLOUDINARY_API_KEY;
        if (prevEnv.secret !== undefined) process.env.CLOUDINARY_API_SECRET = prevEnv.secret;
        else delete process.env.CLOUDINARY_API_SECRET;
    });

    const unconfiguredDel = await requestJson("/api/uploads/cchat%2Fattachments%2Ftest", {
        method: "DELETE"
    });
    assert.equal(unconfiguredDel.status, 503);

    process.env.CLOUDINARY_CLOUD_NAME = "demo";
    process.env.CLOUDINARY_API_KEY = "key";
    process.env.CLOUDINARY_API_SECRET = "secret";

    // Reject SVG avatar (XSS mitigation)
    const svgForm = new FormData();
    svgForm.append("email", "alice@example.com");
    svgForm.append("avatar", new Blob(["<svg onload=alert(1)></svg>"], { type: "image/svg+xml" }), "evil.svg");
    const svgRes = await requestJson("/api/profile/avatar", { method: "POST", body: svgForm });
    assert.equal(svgRes.status, 400);

    // Reject oversized avatar (>10MB) with 413 JSON (not Express HTML 500)
    const bigForm = new FormData();
    bigForm.append("email", "alice@example.com");
    bigForm.append("avatar", new Blob([new Uint8Array(10 * 1024 * 1024 + 1024)], { type: "image/png" }), "big.png");
    const bigRes = await requestJson("/api/profile/avatar", { method: "POST", body: bigForm });
    assert.equal(bigRes.status, 413);
    assert.equal(bigRes.data.error, "File exceeds maximum allowed size");

    // Mock User & Cloudinary for attachment upload and filename sanitization
    t.mock.method(User, "findOne", async () => ({ _id: new mongoose.Types.ObjectId(), email: "alice@example.com" }));
    t.mock.method(cloudinary.uploader, "upload_stream", (options, cb) => {
        const stream = new EventEmitter();
        stream.end = () => {
            cb(null, {
                secure_url: "https://res.cloudinary.com/demo/raw/upload/v1/cchat/attachments/evil.txt",
                public_id: "cchat/attachments/evil.txt",
                resource_type: options.resource_type,
                format: "txt"
            });
        };
        return stream;
    });

    const uploadForm = new FormData();
    uploadForm.append("email", "alice@example.com");
    uploadForm.append("file", new Blob(["hello"], { type: "text/plain" }), "../../evil.txt");
    const upRes = await requestJson("/api/uploads", { method: "POST", body: uploadForm });
    assert.equal(upRes.status, 201);
    assert.equal(upRes.data.attachment.originalName, "evil.txt");
    assert.equal(upRes.data.type, "file");

    // Path traversal & cross-folder deletion blocked
    const traversalDel = await requestJson("/api/uploads/" + encodeURIComponent("cchat/attachments/../avatars/u1"), {
        method: "DELETE"
    });
    assert.equal(traversalDel.status, 400);

    const avatarFolderDel = await requestJson("/api/uploads/" + encodeURIComponent("cchat/avatars/u1"), {
        method: "DELETE"
    });
    assert.equal(avatarFolderDel.status, 400);

    const badResourceType = await requestJson("/api/uploads/" + encodeURIComponent("cchat/attachments/f1") + "?resourceType=script", {
        method: "DELETE"
    });
    assert.equal(badResourceType.status, 400);

    const destroyMock = t.mock.method(cloudinary.uploader, "destroy", async () => ({ result: "ok" }));
    const okDel = await requestJson("/api/uploads/" + encodeURIComponent("cchat/attachments/f1") + "?resourceType=raw", {
        method: "DELETE"
    });
    assert.equal(okDel.status, 200);
    assert.equal(okDel.data.ok, true);
    assert.equal(destroyMock.mock.callCount(), 1);
});

test("GET /api/gifs/search validates configuration, query, and normalizes GIPHY response", async t => {
    const prevKey = process.env.GIPHY_API_KEY;
    delete process.env.GIPHY_API_KEY;
    t.after(() => {
        if (prevKey !== undefined) process.env.GIPHY_API_KEY = prevKey;
        else delete process.env.GIPHY_API_KEY;
    });

    const noKey = await requestJson("/api/gifs/search?q=cat");
    assert.equal(noKey.status, 503);

    process.env.GIPHY_API_KEY = "test-key";

    const emptyQ = await requestJson("/api/gifs/search?q=");
    assert.equal(emptyQ.status, 400);

    t.mock.method(https, "get", (_url, cb) => {
        const req = new EventEmitter();
        req.setTimeout = () => {};
        req.destroy = () => {};

        const res = new EventEmitter();
        res.statusCode = 200;
        res.destroy = () => {};

        process.nextTick(() => {
            cb(res);
            res.emit("data", Buffer.from(JSON.stringify({
                data: [
                    {
                        id: "gif1",
                        title: "Happy Cat",
                        images: {
                            original: { url: "https://media.giphy.com/cat.gif", width: "400", height: "300" },
                            fixed_width: { url: "https://media.giphy.com/cat_fw.gif" }
                        }
                    }
                ]
            })));
            res.emit("end");
        });

        return req;
    });

    const ok = await requestJson("/api/gifs/search?q=cat&limit=5");
    assert.equal(ok.status, 200);
    assert.equal(ok.data.results.length, 1);
    assert.equal(ok.data.results[0].id, "gif1");
    assert.equal(ok.data.results[0].width, 400);
});
