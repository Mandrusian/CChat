const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");
const http = require("http");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const https = require("https");
const path = require("path");

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_AVATAR_SIZE = 10 * 1024 * 1024;
const MAX_GIPHY_RESPONSE_BYTES = 5 * 1024 * 1024;
const GIPHY_TIMEOUT_MS = 10000;

const ALLOWED_AVATAR_MIMES = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/avif"
]);
const ALLOWED_MESSAGE_TYPES = new Set(["text", "image", "video", "file", "gif"]);
const ALLOWED_RESOURCE_TYPES = new Set(["image", "video", "raw"]);

function parseCorsOrigin(rawOrigin) {
    if (!rawOrigin || rawOrigin.trim() === "*") {
        return "*";
    }
    const origins = rawOrigin
        .split(",")
        .map(origin => origin.trim())
        .filter(Boolean);
    return origins.length > 0 ? origins : "*";
}

const corsOrigin = parseCorsOrigin(process.env.CORS_ORIGIN);

const app = express();
app.disable("x-powered-by");

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: corsOrigin,
        methods: ["GET", "POST", "DELETE", "PUT", "PATCH"]
    }
});

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
});

app.use(cors({
    origin: corsOrigin,
    methods: ["GET", "POST", "DELETE", "PUT", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;

function configureCloudinary() {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
}

configureCloudinary();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1
    }
});

const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_AVATAR_SIZE,
        files: 1
    }
});

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        trim: true,
        maxlength: 40
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        maxlength: 254
    },
    passwordHash: {
        type: String,
        required: true
    },
    avatarUrl: {
        type: String,
        default: null
    },
    avatarPublicId: {
        type: String,
        default: null
    }
}, {
    timestamps: true
});

const threadSchema = new mongoose.Schema({
    participants: [{
        type: String,
        lowercase: true,
        trim: true
    }],
    isGroup: {
        type: Boolean,
        default: false
    },
    groupName: {
        type: String,
        default: null,
        maxlength: 100
    }
}, {
    timestamps: true
});

const attachmentSchema = new mongoose.Schema({
    url: String,
    publicId: String,
    resourceType: String,
    mimeType: String,
    originalName: String,
    size: Number,
    width: Number,
    height: Number,
    duration: Number,
    format: String
}, {
    _id: false
});

const messageSchema = new mongoose.Schema({
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Thread",
        required: true,
        index: true
    },
    senderEmail: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    text: {
        type: String,
        default: "",
        maxlength: 10000
    },
    type: {
        type: String,
        enum: ["text", "image", "video", "file", "gif"],
        default: "text"
    },
    attachment: {
        type: attachmentSchema,
        default: null
    },
    replyTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message",
        default: null
    },
    deleted: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

messageSchema.index({ threadId: 1, createdAt: 1 });

const User = mongoose.model("User", userSchema);
const Thread = mongoose.model("Thread", threadSchema);
const Message = mongoose.model("Message", messageSchema);

function normalizeEmail(email) {
    if (typeof email !== "string" && typeof email !== "number") {
        return "";
    }
    return String(email).trim().toLowerCase();
}

function isValidEmail(email) {
    if (typeof email !== "string" || email.length === 0 || email.length > 254) {
        return false;
    }
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidObjectId(id) {
    return typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
}

function isSafeHttpUrl(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
        return false;
    }
    try {
        const parsed = new URL(value);
        return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
        return false;
    }
}

function sanitizeFilename(name) {
    if (typeof name !== "string") {
        return "file";
    }
    const base = path.posix.basename(name.replace(/\\/g, "/"));
    const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 255);
    if (!cleaned || cleaned === "." || cleaned === "..") {
        return "file";
    }
    return cleaned;
}

function sanitizePublicId(rawPublicId) {
    if (typeof rawPublicId !== "string" || rawPublicId.length === 0) {
        return null;
    }

    let decoded;
    try {
        decoded = decodeURIComponent(rawPublicId);
    } catch {
        return null;
    }

    if (
        !decoded ||
        decoded.length > 300 ||
        decoded.includes("\0") ||
        decoded.includes("\\") ||
        decoded.startsWith("/")
    ) {
        return null;
    }

    const segments = decoded.split("/");
    if (
        segments.some(seg => !seg || seg === "." || seg === ".." || !/^[a-zA-Z0-9_.-]+$/.test(seg))
    ) {
        return null;
    }

    if (!decoded.startsWith("cchat/attachments/")) {
        return null;
    }

    return decoded;
}

function toFiniteNonNegativeNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
        return null;
    }
    return num;
}

function sanitizeAttachment(raw) {
    if (raw === null || raw === undefined) {
        return { attachment: null };
    }

    if (typeof raw !== "object" || Array.isArray(raw)) {
        return { error: "Attachment must be an object" };
    }

    if (!isSafeHttpUrl(raw.url)) {
        return { error: "Attachment URL must be a valid http or https URL" };
    }

    const resourceType = ALLOWED_RESOURCE_TYPES.has(raw.resourceType)
        ? raw.resourceType
        : null;

    return {
        attachment: {
            url: raw.url,
            publicId: typeof raw.publicId === "string" ? raw.publicId.slice(0, 300) : null,
            resourceType,
            mimeType: typeof raw.mimeType === "string" ? raw.mimeType.slice(0, 128) : null,
            originalName: raw.originalName ? sanitizeFilename(raw.originalName) : null,
            size: toFiniteNonNegativeNumber(raw.size),
            width: toFiniteNonNegativeNumber(raw.width),
            height: toFiniteNonNegativeNumber(raw.height),
            duration: toFiniteNonNegativeNumber(raw.duration),
            format: typeof raw.format === "string" ? raw.format.slice(0, 32) : null
        }
    };
}

function serializeUser(user) {
    return {
        id: String(user._id),
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl || null,
        createdAt: user.createdAt
    };
}

function serializeAttachment(attachment) {
    if (!attachment) return null;

    return {
        url: attachment.url,
        publicId: attachment.publicId,
        resourceType: attachment.resourceType,
        mimeType: attachment.mimeType,
        originalName: attachment.originalName,
        size: attachment.size,
        width: attachment.width,
        height: attachment.height,
        duration: attachment.duration,
        format: attachment.format
    };
}

function serializeMessage(message) {
    const reply = message.replyTo && typeof message.replyTo === "object"
        ? {
            id: String(message.replyTo._id),
            senderEmail: message.replyTo.senderEmail,
            text: message.replyTo.deleted ? "Message deleted" : message.replyTo.text,
            type: message.replyTo.type,
            attachment: serializeAttachment(message.replyTo.attachment),
            deleted: message.replyTo.deleted
        }
        : null;

    return {
        id: String(message._id),
        threadId: String(message.threadId),
        senderEmail: message.senderEmail,
        text: message.deleted ? "" : message.text,
        type: message.deleted ? "text" : message.type,
        attachment: message.deleted ? null : serializeAttachment(message.attachment),
        replyTo: reply,
        deleted: message.deleted,
        deletedAt: message.deletedAt,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
    };
}

function serializeThread(thread) {
    return {
        id: String(thread._id),
        participants: thread.participants,
        isGroup: thread.isGroup,
        groupName: thread.groupName,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt
    };
}

function uploadBuffer(buffer, options) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            options,
            (error, result) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(result);
            }
        );

        stream.end(buffer);
    });
}

function destroyCloudinary(publicId, resourceType = "image") {
    if (!publicId) return Promise.resolve();

    return cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType
    }).catch(() => {});
}

function inferMessageType(mimeType) {
    if (!mimeType || typeof mimeType !== "string") return "file";

    const normalized = mimeType.toLowerCase();
    if (normalized === "image/svg+xml") {
        return "file";
    }

    if (normalized.startsWith("image/")) {
        return "image";
    }

    if (normalized.startsWith("video/")) {
        return "video";
    }

    return "file";
}

function isCloudinaryConfigured() {
    return Boolean(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    );
}

function requireCloudinary() {
    if (!isCloudinaryConfigured()) {
        const err = new Error("Cloudinary environment variables are not configured");
        err.statusCode = 503;
        throw err;
    }
    configureCloudinary();
}

async function createMessage(data) {
    const message = await Message.create(data);

    return Message.findById(message._id)
        .populate("replyTo");
}

app.get("/", (req, res) => {
    res.json({
        name: "CChat Backend",
        status: "online",
        version: "2.0.0"
    });
});

app.get("/api/health", async (req, res) => {
    const mongoState = mongoose.connection.readyState;

    res.json({
        ok: true,
        mongo: mongoState === 1 ? "connected" : "disconnected",
        cloudinary: isCloudinaryConfigured(),
        gifs: Boolean(process.env.GIPHY_API_KEY)
    });
});

app.post("/api/register", async (req, res) => {
    try {
        const body = req.body || {};
        const username = typeof body.username === "string" ? body.username.trim() : "";
        const email = normalizeEmail(body.email);
        const password = typeof body.password === "string" ? body.password : "";

        if (!username || !email || !password) {
            return res.status(400).json({
                error: "Username, email and password are required"
            });
        }

        if (username.length > 40) {
            return res.status(400).json({
                error: "Username must be at most 40 characters"
            });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({
                error: "Invalid email address"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                error: "Password must be at least 6 characters"
            });
        }

        if (password.length > 128) {
            return res.status(400).json({
                error: "Password must be at most 128 characters"
            });
        }

        const existing = await User.findOne({ email });

        if (existing) {
            return res.status(409).json({
                error: "An account with that email already exists"
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const user = await User.create({
            username,
            email,
            passwordHash
        });

        res.status(201).json({
            user: serializeUser(user)
        });
    } catch (error) {
        if (error && error.code === 11000) {
            return res.status(409).json({
                error: "An account with that email already exists"
            });
        }
        console.error(error);
        res.status(500).json({
            error: "Registration failed"
        });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        const body = req.body || {};
        const email = normalizeEmail(body.email);
        const password = typeof body.password === "string" ? body.password : "";

        if (!email || !password) {
            return res.status(400).json({
                error: "Email and password are required"
            });
        }

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(401).json({
                error: "Invalid email or password"
            });
        }

        const valid = await bcrypt.compare(password, user.passwordHash);

        if (!valid) {
            return res.status(401).json({
                error: "Invalid email or password"
            });
        }

        res.json({
            user: serializeUser(user)
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Login failed"
        });
    }
});

app.get("/api/users/search", async (req, res) => {
    try {
        const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";

        if (!q) {
            return res.json([]);
        }

        const safePattern = escapeRegex(q);

        const users = await User.find({
            $or: [
                { email: { $regex: safePattern, $options: "i" } },
                { username: { $regex: safePattern, $options: "i" } }
            ]
        })
        .select("username email avatarUrl createdAt")
        .limit(20);

        res.json(users.map(serializeUser));
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "User search failed"
        });
    }
});

app.get("/api/threads/:email", async (req, res) => {
    try {
        const email = normalizeEmail(req.params.email);

        if (!isValidEmail(email)) {
            return res.status(400).json({
                error: "Invalid email address"
            });
        }

        const threads = await Thread.find({
            participants: email
        })
        .sort({ updatedAt: -1 });

        res.json(threads.map(serializeThread));
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Failed to load threads"
        });
    }
});

app.get("/api/threads/:threadId/messages", async (req, res) => {
    try {
        const { threadId } = req.params;

        if (!isValidObjectId(threadId)) {
            return res.status(400).json({
                error: "Invalid thread ID"
            });
        }

        const messages = await Message.find({
            threadId
        })
        .sort({ createdAt: 1 })
        .populate("replyTo");

        res.json(messages.map(serializeMessage));
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Failed to load messages"
        });
    }
});

app.post("/api/threads/create", async (req, res) => {
    try {
        const body = req.body || {};
        const isGroup = Boolean(body.isGroup);
        const groupName = typeof body.groupName === "string" ? body.groupName.trim() : "";

        if (!Array.isArray(body.participants)) {
            return res.status(400).json({
                error: "Participants must be an array"
            });
        }

        const participants = Array.from(
            new Set(
                body.participants
                    .map(normalizeEmail)
                    .filter(Boolean)
            )
        );

        if (participants.length < 2) {
            return res.status(400).json({
                error: "At least two participants are required"
            });
        }

        if (participants.length > 100) {
            return res.status(400).json({
                error: "Too many participants"
            });
        }

        if (participants.some(p => !isValidEmail(p))) {
            return res.status(400).json({
                error: "All participants must have valid email addresses"
            });
        }

        if (isGroup && !groupName) {
            return res.status(400).json({
                error: "Group name is required"
            });
        }

        if (groupName.length > 100) {
            return res.status(400).json({
                error: "Group name must be at most 100 characters"
            });
        }

        if (!isGroup && participants.length === 2) {
            const existing = await Thread.findOne({
                isGroup: false,
                participants: {
                    $all: participants,
                    $size: 2
                }
            });

            if (existing) {
                return res.json(serializeThread(existing));
            }
        }

        const thread = await Thread.create({
            participants,
            isGroup,
            groupName: isGroup ? groupName : null
        });

        res.status(201).json(serializeThread(thread));
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Failed to create thread"
        });
    }
});

app.post("/api/profile/avatar", avatarUpload.single("avatar"), async (req, res) => {
    try {
        requireCloudinary();

        const body = req.body || {};
        const email = normalizeEmail(body.email);

        if (!email || !req.file) {
            return res.status(400).json({
                error: "Email and avatar are required"
            });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({
                error: "Invalid email address"
            });
        }

        if (req.file.size === 0) {
            return res.status(400).json({
                error: "Avatar file cannot be empty"
            });
        }

        if (!ALLOWED_AVATAR_MIMES.has(req.file.mimetype)) {
            return res.status(400).json({
                error: "Avatar must be a PNG, JPEG, GIF, WebP, or AVIF image"
            });
        }

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({
                error: "User not found"
            });
        }

        if (user.avatarPublicId) {
            await destroyCloudinary(user.avatarPublicId, "image");
        }

        const result = await uploadBuffer(req.file.buffer, {
            folder: "cchat/avatars",
            resource_type: "image",
            transformation: [
                {
                    width: 512,
                    height: 512,
                    crop: "fill",
                    gravity: "face"
                }
            ]
        });

        user.avatarUrl = result.secure_url;
        user.avatarPublicId = result.public_id;

        await user.save();

        io.emit("user_updated", serializeUser(user));

        res.json({
            user: serializeUser(user)
        });
    } catch (error) {
        if (error && error.statusCode === 503) {
            return res.status(503).json({
                error: error.message
            });
        }
        console.error(error);
        res.status(500).json({
            error: "Avatar upload failed"
        });
    }
});

app.delete("/api/profile/avatar", async (req, res) => {
    try {
        requireCloudinary();

        const body = req.body || {};
        const email = normalizeEmail(body.email || req.query.email);

        if (!isValidEmail(email)) {
            return res.status(400).json({
                error: "Valid email is required"
            });
        }

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({
                error: "User not found"
            });
        }

        if (user.avatarPublicId) {
            await destroyCloudinary(user.avatarPublicId, "image");
        }

        user.avatarUrl = null;
        user.avatarPublicId = null;

        await user.save();

        io.emit("user_updated", serializeUser(user));

        res.json({
            user: serializeUser(user)
        });
    } catch (error) {
        if (error && error.statusCode === 503) {
            return res.status(503).json({
                error: error.message
            });
        }
        console.error(error);
        res.status(500).json({
            error: "Avatar deletion failed"
        });
    }
});

app.post("/api/uploads", upload.single("file"), async (req, res) => {
    try {
        requireCloudinary();

        const body = req.body || {};
        const email = normalizeEmail(body.email);

        if (!email || !req.file) {
            return res.status(400).json({
                error: "Email and file are required"
            });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({
                error: "Invalid email address"
            });
        }

        if (req.file.size === 0) {
            return res.status(400).json({
                error: "Uploaded file cannot be empty"
            });
        }

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({
                error: "User not found"
            });
        }

        const mimeType = String(req.file.mimetype || "application/octet-stream").toLowerCase();
        const originalName = sanitizeFilename(req.file.originalname);
        const messageType = inferMessageType(mimeType);

        const resourceType =
            mimeType === "image/svg+xml" ? "raw" :
            mimeType.startsWith("image/") ? "image" :
            mimeType.startsWith("video/") ? "video" :
            "raw";

        const result = await uploadBuffer(req.file.buffer, {
            folder: "cchat/attachments",
            resource_type: resourceType,
            use_filename: true,
            unique_filename: true
        });

        res.status(201).json({
            attachment: {
                url: result.secure_url,
                publicId: result.public_id,
                resourceType: result.resource_type,
                mimeType,
                originalName,
                size: req.file.size,
                width: result.width || null,
                height: result.height || null,
                duration: result.duration || null,
                format: result.format || null
            },
            type: messageType
        });
    } catch (error) {
        if (error && error.statusCode === 503) {
            return res.status(503).json({
                error: error.message
            });
        }
        console.error(error);
        res.status(500).json({
            error: "File upload failed"
        });
    }
});

app.delete("/api/uploads/:publicId", async (req, res) => {
    try {
        requireCloudinary();

        const publicId = sanitizePublicId(req.params.publicId);
        if (!publicId) {
            return res.status(400).json({
                error: "Invalid upload publicId"
            });
        }

        const resourceType = String(req.query.resourceType || "image");
        if (!ALLOWED_RESOURCE_TYPES.has(resourceType)) {
            return res.status(400).json({
                error: "Invalid resourceType"
            });
        }

        await destroyCloudinary(publicId, resourceType);

        res.json({
            ok: true
        });
    } catch (error) {
        if (error && error.statusCode === 503) {
            return res.status(503).json({
                error: error.message
            });
        }
        console.error(error);
        res.status(500).json({
            error: "File deletion failed"
        });
    }
});

app.post("/api/messages/send", async (req, res) => {
    try {
        const body = req.body || {};
        const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
        const senderEmail = normalizeEmail(body.senderEmail);
        const text = typeof body.text === "string" ? body.text : "";
        const type = ALLOWED_MESSAGE_TYPES.has(body.type) ? body.type : "text";
        const replyTo = body.replyTo || null;

        if (!threadId || !senderEmail) {
            return res.status(400).json({
                error: "Thread and sender are required"
            });
        }

        if (!isValidObjectId(threadId)) {
            return res.status(400).json({
                error: "Invalid thread ID"
            });
        }

        if (!isValidEmail(senderEmail)) {
            return res.status(400).json({
                error: "Invalid sender email"
            });
        }

        if (text.length > 10000) {
            return res.status(400).json({
                error: "Message text exceeds 10000 characters"
            });
        }

        const { attachment, error: attachmentError } = sanitizeAttachment(body.attachment);
        if (attachmentError) {
            return res.status(400).json({
                error: attachmentError
            });
        }

        if (!text && !attachment) {
            return res.status(400).json({
                error: "Message cannot be empty"
            });
        }

        if (replyTo !== null && !isValidObjectId(String(replyTo))) {
            return res.status(400).json({
                error: "Invalid reply message ID"
            });
        }

        const thread = await Thread.findById(threadId);

        if (!thread) {
            return res.status(404).json({
                error: "Thread not found"
            });
        }

        if (!thread.participants.includes(senderEmail)) {
            return res.status(403).json({
                error: "Sender is not a member of this thread"
            });
        }

        if (replyTo) {
            const replyMessage = await Message.findById(replyTo);

            if (!replyMessage || String(replyMessage.threadId) !== threadId) {
                return res.status(400).json({
                    error: "Invalid reply message"
                });
            }
        }

        const message = await createMessage({
            threadId,
            senderEmail,
            text,
            type,
            attachment,
            replyTo
        });

        thread.updatedAt = new Date();
        await thread.save();

        const serialized = serializeMessage(message);

        io.to(`thread:${threadId}`).emit("chat_message", serialized);

        for (const participant of thread.participants) {
            io.to(`user:${participant}`).emit("thread_updated", serializeThread(thread));
        }

        res.status(201).json(serialized);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Message send failed"
        });
    }
});

app.post("/api/messages/:id/reply", async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({
                error: "Invalid message ID"
            });
        }

        const original = await Message.findById(req.params.id);

        if (!original) {
            return res.status(404).json({
                error: "Message not found"
            });
        }

        const body = req.body || {};
        const senderEmail = normalizeEmail(body.senderEmail);
        const text = typeof body.text === "string" ? body.text : "";

        if (!isValidEmail(senderEmail)) {
            return res.status(400).json({
                error: "Valid senderEmail is required"
            });
        }

        if (text.length > 10000) {
            return res.status(400).json({
                error: "Reply text exceeds 10000 characters"
            });
        }

        const { attachment, error: attachmentError } = sanitizeAttachment(body.attachment);
        if (attachmentError) {
            return res.status(400).json({
                error: attachmentError
            });
        }

        const type = ALLOWED_MESSAGE_TYPES.has(body.type)
            ? body.type
            : attachment
                ? inferMessageType(attachment.mimeType)
                : "text";

        const thread = await Thread.findById(original.threadId);

        if (!thread || !thread.participants.includes(senderEmail)) {
            return res.status(403).json({
                error: "Not allowed"
            });
        }

        if (!text && !attachment) {
            return res.status(400).json({
                error: "Reply cannot be empty"
            });
        }

        const message = await createMessage({
            threadId: original.threadId,
            senderEmail,
            text,
            type,
            attachment,
            replyTo: original._id
        });

        thread.updatedAt = new Date();
        await thread.save();

        const serialized = serializeMessage(message);

        io.to(`thread:${original.threadId}`).emit("chat_message", serialized);

        for (const participant of thread.participants) {
            io.to(`user:${participant}`).emit("thread_updated", serializeThread(thread));
        }

        res.status(201).json(serialized);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Reply failed"
        });
    }
});

app.delete("/api/messages/:id", async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({
                error: "Invalid message ID"
            });
        }

        const body = req.body || {};
        const senderEmail = normalizeEmail(body.senderEmail || req.query.senderEmail);

        if (!isValidEmail(senderEmail)) {
            return res.status(400).json({
                error: "Valid senderEmail is required"
            });
        }

        const message = await Message.findById(req.params.id);

        if (!message) {
            return res.status(404).json({
                error: "Message not found"
            });
        }

        if (message.senderEmail !== senderEmail) {
            return res.status(403).json({
                error: "You can only delete your own messages"
            });
        }

        if (!message.deleted) {
            if (message.attachment && message.attachment.publicId) {
                await destroyCloudinary(
                    message.attachment.publicId,
                    message.attachment.resourceType || "image"
                );
            }

            message.deleted = true;
            message.deletedAt = new Date();
            message.text = "";
            message.attachment = null;

            await message.save();
        }

        const serialized = serializeMessage(
            await Message.findById(message._id).populate("replyTo")
        );

        io.to(`thread:${message.threadId}`).emit(
            "message_deleted",
            serialized
        );

        res.json(serialized);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Message deletion failed"
        });
    }
});

app.get("/api/gifs/search", async (req, res) => {
    try {
        const key = process.env.GIPHY_API_KEY;

        if (!key) {
            return res.status(503).json({
                error: "GIPHY_API_KEY is not configured"
            });
        }

        const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 50) : "";
        const limit = Math.min(
            Math.max(Number(req.query.limit) || 20, 1),
            50
        );

        if (!q) {
            return res.status(400).json({
                error: "Search query is required"
            });
        }

        const url =
            "https://api.giphy.com/v1/gifs/search?" +
            new URLSearchParams({
                api_key: key,
                q,
                limit: String(limit),
                rating: "pg-13",
                lang: "en"
            }).toString();

        const giphyReq = https.get(url, response => {
            let body = "";
            let totalBytes = 0;
            let aborted = false;

            response.on("data", chunk => {
                totalBytes += chunk.length;
                if (totalBytes > MAX_GIPHY_RESPONSE_BYTES) {
                    aborted = true;
                    response.destroy();
                    if (!res.headersSent) {
                        res.status(502).json({
                            error: "GIPHY response too large"
                        });
                    }
                    return;
                }
                body += chunk;
            });

            response.on("end", () => {
                if (aborted || res.headersSent) {
                    return;
                }
                try {
                    const data = JSON.parse(body);

                    if (response.statusCode < 200 || response.statusCode >= 300) {
                        return res.status(response.statusCode || 502).json({
                            error: "GIPHY request failed"
                        });
                    }

                    const results = (data.data || []).map(gif => ({
                        id: gif.id,
                        title: gif.title || "",
                        url: gif.images?.original?.url || null,
                        preview: gif.images?.fixed_width?.url || gif.images?.original?.url || null,
                        width: Number(gif.images?.original?.width || 0),
                        height: Number(gif.images?.original?.height || 0)
                    }));

                    res.json({
                        results
                    });
                } catch {
                    res.status(502).json({
                        error: "Invalid GIPHY response"
                    });
                }
            });
        });

        giphyReq.setTimeout(GIPHY_TIMEOUT_MS, () => {
            giphyReq.destroy(new Error("GIPHY request timed out"));
        });

        giphyReq.on("error", () => {
            if (!res.headersSent) {
                res.status(502).json({
                    error: "GIPHY connection failed"
                });
            }
        });
    } catch (error) {
        console.error(error);
        if (!res.headersSent) {
            res.status(500).json({
                error: "GIF search failed"
            });
        }
    }
});

app.use("/api", (req, res) => {
    res.status(404).json({
        error: "Not found"
    });
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({
                error: "File exceeds maximum allowed size"
            });
        }
        return res.status(400).json({
            error: err.message || "File upload error"
        });
    }

    if (err && err.type === "entity.too.large") {
        return res.status(413).json({
            error: "Request payload too large"
        });
    }

    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
        return res.status(400).json({
            error: "Invalid JSON payload"
        });
    }

    console.error(err);
    res.status(500).json({
        error: "Internal server error"
    });
});

io.on("connection", socket => {
    socket.on("join_thread", threadId => {
        if (typeof threadId === "string" && threadId.trim().length > 0 && threadId.length <= 64) {
            socket.join(`thread:${threadId.trim()}`);
        }
    });

    socket.on("leave_thread", threadId => {
        if (typeof threadId === "string" && threadId.trim().length > 0 && threadId.length <= 64) {
            socket.leave(`thread:${threadId.trim()}`);
        }
    });

    socket.on("join_user", email => {
        const normalized = normalizeEmail(email);

        if (isValidEmail(normalized)) {
            socket.join(`user:${normalized}`);
        }
    });

    socket.on("typing", data => {
        if (!data || typeof data.threadId !== "string") {
            return;
        }

        const threadId = data.threadId.trim();
        if (!threadId || threadId.length > 64) {
            return;
        }

        socket.to(`thread:${threadId}`).emit("typing", {
            threadId,
            email: normalizeEmail(data.email),
            typing: Boolean(data.typing)
        });
    });

    socket.on("disconnect", () => {});
});

async function connectDatabase(uri = process.env.MONGO_URI) {
    if (!uri) {
        throw new Error("MONGO_URI is required");
    }
    return mongoose.connect(uri);
}

async function startServer() {
    await connectDatabase(process.env.MONGO_URI);
    console.log("MongoDB connected");

    return new Promise(resolve => {
        server.listen(PORT, "0.0.0.0", () => {
            console.log(`CChat backend listening on ${PORT}`);
            resolve(server);
        });
    });
}

if (require.main === module) {
    startServer().catch(error => {
        console.error("MongoDB connection failed:", error);
        process.exit(1);
    });
}

module.exports = {
    app,
    server,
    io,
    startServer,
    connectDatabase,
    models: {
        User,
        Thread,
        Message
    },
    helpers: {
        normalizeEmail,
        isValidEmail,
        escapeRegex,
        isValidObjectId,
        isSafeHttpUrl,
        sanitizeFilename,
        sanitizePublicId,
        sanitizeAttachment,
        inferMessageType,
        serializeUser,
        serializeAttachment,
        serializeMessage,
        serializeThread,
        parseCorsOrigin
    }
};
