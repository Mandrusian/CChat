const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");
const http = require("http");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const https = require("https");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "DELETE", "PUT", "PATCH"]
    }
});

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE", "PUT", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    throw new Error("MONGO_URI is required");
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024
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
        required: true
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

const User = mongoose.model("User", userSchema);
const Thread = mongoose.model("Thread", threadSchema);
const Message = mongoose.model("Message", messageSchema);

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
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
    if (!mimeType) return "file";

    if (mimeType.startsWith("image/")) {
        return "image";
    }

    if (mimeType.startsWith("video/")) {
        return "video";
    }

    return "file";
}

function requireCloudinary() {
    if (
        !process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET
    ) {
        throw new Error("Cloudinary environment variables are not configured");
    }
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
        cloudinary: Boolean(
            process.env.CLOUDINARY_CLOUD_NAME &&
            process.env.CLOUDINARY_API_KEY &&
            process.env.CLOUDINARY_API_SECRET
        ),
        gifs: Boolean(process.env.GIPHY_API_KEY)
    });
});

app.post("/api/register", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const email = normalizeEmail(req.body.email);
        const password = String(req.body.password || "");

        if (!username || !email || !password) {
            return res.status(400).json({
                error: "Username, email and password are required"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                error: "Password must be at least 6 characters"
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
        console.error(error);
        res.status(500).json({
            error: "Registration failed"
        });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const password = String(req.body.password || "");

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
        const q = String(req.query.q || "").trim();

        if (!q) {
            return res.json([]);
        }

        const users = await User.find({
            $or: [
                { email: { $regex: q, $options: "i" } },
                { username: { $regex: q, $options: "i" } }
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
        const messages = await Message.find({
            threadId: req.params.threadId
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
        const isGroup = Boolean(req.body.isGroup);
        const groupName = String(req.body.groupName || "").trim();
        const participants = Array.from(
            new Set(
                (req.body.participants || [])
                    .map(normalizeEmail)
                    .filter(Boolean)
            )
        );

        if (participants.length < 2) {
            return res.status(400).json({
                error: "At least two participants are required"
            });
        }

        if (isGroup && !groupName) {
            return res.status(400).json({
                error: "Group name is required"
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

app.post("/api/profile/avatar", upload.single("avatar"), async (req, res) => {
    try {
        requireCloudinary();

        const email = normalizeEmail(req.body.email);

        if (!email || !req.file) {
            return res.status(400).json({
                error: "Email and avatar are required"
            });
        }

        if (!req.file.mimetype.startsWith("image/")) {
            return res.status(400).json({
                error: "Avatar must be an image"
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
        console.error(error);
        res.status(500).json({
            error: "Avatar upload failed"
        });
    }
});

app.delete("/api/profile/avatar", async (req, res) => {
    try {
        requireCloudinary();

        const email = normalizeEmail(req.body.email);
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
        console.error(error);
        res.status(500).json({
            error: "Avatar deletion failed"
        });
    }
});

app.post("/api/uploads", upload.single("file"), async (req, res) => {
    try {
        requireCloudinary();

        const email = normalizeEmail(req.body.email);

        if (!email || !req.file) {
            return res.status(400).json({
                error: "Email and file are required"
            });
        }

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({
                error: "User not found"
            });
        }

        const messageType = inferMessageType(req.file.mimetype);

        const resourceType =
            req.file.mimetype.startsWith("image/") ? "image" :
            req.file.mimetype.startsWith("video/") ? "video" :
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
                mimeType: req.file.mimetype,
                originalName: req.file.originalname,
                size: req.file.size,
                width: result.width || null,
                height: result.height || null,
                duration: result.duration || null,
                format: result.format || null
            },
            type: messageType
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "File upload failed"
        });
    }
});

app.delete("/api/uploads/:publicId", async (req, res) => {
    try {
        requireCloudinary();

        const publicId = decodeURIComponent(req.params.publicId);
        const resourceType = String(req.query.resourceType || "image");

        await destroyCloudinary(publicId, resourceType);

        res.json({
            ok: true
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "File deletion failed"
        });
    }
});

app.post("/api/messages/send", async (req, res) => {
    try {
        const threadId = String(req.body.threadId || "");
        const senderEmail = normalizeEmail(req.body.senderEmail);
        const text = String(req.body.text || "");
        const type = ["text", "image", "video", "file", "gif"].includes(req.body.type)
            ? req.body.type
            : "text";
        const replyTo = req.body.replyTo || null;
        const attachment = req.body.attachment || null;

        if (!threadId || !senderEmail) {
            return res.status(400).json({
                error: "Thread and sender are required"
            });
        }

        if (!text && !attachment) {
            return res.status(400).json({
                error: "Message cannot be empty"
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
        const original = await Message.findById(req.params.id);

        if (!original) {
            return res.status(404).json({
                error: "Message not found"
            });
        }

        const senderEmail = normalizeEmail(req.body.senderEmail);
        const text = String(req.body.text || "");
        const attachment = req.body.attachment || null;
        const type = ["text", "image", "video", "file", "gif"].includes(req.body.type)
            ? req.body.type
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
        const senderEmail = normalizeEmail(req.body.senderEmail);

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

        const q = String(req.query.q || "").trim().slice(0, 50);
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

        https.get(url, response => {
            let body = "";

            response.on("data", chunk => {
                body += chunk;
            });

            response.on("end", () => {
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
        }).on("error", () => {
            res.status(502).json({
                error: "GIPHY connection failed"
            });
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "GIF search failed"
        });
    }
});

io.on("connection", socket => {
    socket.on("join_thread", threadId => {
        if (threadId) {
            socket.join(`thread:${threadId}`);
        }
    });

    socket.on("leave_thread", threadId => {
        if (threadId) {
            socket.leave(`thread:${threadId}`);
        }
    });

    socket.on("join_user", email => {
        const normalized = normalizeEmail(email);

        if (normalized) {
            socket.join(`user:${normalized}`);
        }
    });

    socket.on("typing", data => {
        if (!data || !data.threadId) {
            return;
        }

        socket.to(`thread:${data.threadId}`).emit("typing", {
            threadId: data.threadId,
            email: normalizeEmail(data.email),
            typing: Boolean(data.typing)
        });
    });

    socket.on("disconnect", () => {});
});

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log("MongoDB connected");

        server.listen(PORT, "0.0.0.0", () => {
            console.log(`CChat backend listening on ${PORT}`);
        });
    })
    .catch(error => {
        console.error("MongoDB connection failed:", error);
        process.exit(1);
    });
