const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error("MONGO_URI environment variable is required");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log("Connected to MongoDB Atlas"))
    .catch(err => {
        console.error("MongoDB connection error:", err);
        process.exit(1);
    });

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        unique: true,
        required: true,
        lowercase: true,
        trim: true
    },
    passwordHash: {
        type: String,
        required: true
    },
    username: {
        type: String,
        default: ""
    }
});

const threadSchema = new mongoose.Schema({
    isGroup: {
        type: Boolean,
        default: false
    },
    groupName: {
        type: String,
        default: ""
    },
    participants: [{
        type: String
    }],
    lastMessageAt: {
        type: Date,
        default: Date.now
    }
});

const messageSchema = new mongoose.Schema({
    threadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Thread",
        required: true
    },
    senderEmail: {
        type: String,
        required: true
    },
    text: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

const User = mongoose.model("User", userSchema);
const Thread = mongoose.model("Thread", threadSchema);
const Message = mongoose.model("Message", messageSchema);

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function serializeUser(user) {
    return {
        email: user.email,
        username: user.username || user.email.split("@")[0]
    };
}

function serializeMessage(message) {
    return {
        id: message._id.toString(),
        _id: message._id.toString(),
        threadId: message.threadId.toString(),
        senderEmail: message.senderEmail,
        sender: message.senderEmail,
        text: message.text,
        content: message.text,
        message: message.text,
        timestamp: message.timestamp,
        createdAt: message.timestamp
    };
}

function serializeThread(thread, latestMessage) {
    return {
        id: thread._id.toString(),
        _id: thread._id.toString(),
        threadId: thread._id.toString(),
        isGroup: thread.isGroup,
        groupName: thread.groupName,
        name: thread.groupName,
        participants: thread.participants,
        lastMessageAt: thread.lastMessageAt,
        latestMessage: latestMessage ? serializeMessage(latestMessage) : null
    };
}

async function createMessage(threadId, senderEmail, text) {
    const normalizedEmail = normalizeEmail(senderEmail);
    const cleanText = String(text || "").trim();

    if (!mongoose.Types.ObjectId.isValid(threadId)) {
        throw new Error("Invalid thread");
    }

    if (!cleanText) {
        throw new Error("Message cannot be empty");
    }

    const thread = await Thread.findById(threadId);

    if (!thread) {
        throw new Error("Thread not found");
    }

    if (!thread.participants.includes(normalizedEmail)) {
        throw new Error("You are not a participant in this thread");
    }

    const message = await new Message({
        threadId,
        senderEmail: normalizedEmail,
        text: cleanText
    }).save();

    thread.lastMessageAt = message.timestamp;
    await thread.save();

    return {
        message: serializeMessage(message),
        thread: serializeThread(thread)
    };
}

app.get("/", (req, res) => {
    res.json({
        name: "CChat Backend",
        status: "online"
    });
});

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        status: "online"
    });
});

app.post("/api/register", async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const password = String(req.body.password || "");
        const username = String(req.body.username || "").trim();

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: "Email and password are required"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: "Password must be at least 6 characters"
            });
        }

        const existing = await User.findOne({ email });

        if (existing) {
            return res.status(400).json({
                success: false,
                error: "User exists"
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const user = await new User({
            email,
            passwordHash,
            username
        }).save();

        res.json({
            success: true,
            user: serializeUser(user),
            email: user.email,
            username: user.username
        });
    } catch (error) {
        console.error("Register error:", error);
        res.status(500).json({
            success: false,
            error: "Registration failed"
        });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const password = String(req.body.password || "");

        const user = await User.findOne({ email });

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({
                success: false,
                error: "Invalid credentials"
            });
        }

        res.json({
            success: true,
            user: serializeUser(user),
            email: user.email,
            username: user.username
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({
            success: false,
            error: "Login failed"
        });
    }
});

app.get("/api/users/search", async (req, res) => {
    try {
        const query = String(req.query.q || "").trim().toLowerCase();

        if (!query) {
            return res.json({
                success: true,
                users: []
            });
        }

        const users = await User.find({
            $or: [
                { email: { $regex: query, $options: "i" } },
                { username: { $regex: query, $options: "i" } }
            ]
        })
        .select("email username")
        .limit(20);

        res.json({
            success: true,
            users: users.map(serializeUser)
        });
    } catch (error) {
        console.error("User search error:", error);
        res.status(500).json({
            success: false,
            error: "User search failed"
        });
    }
});

app.get("/api/threads/:email", async (req, res) => {
    try {
        const email = normalizeEmail(req.params.email);

        const threads = await Thread.find({
            participants: email
        }).sort({
            lastMessageAt: -1
        });

        const result = await Promise.all(
            threads.map(async thread => {
                const latestMessage = await Message.findOne({
                    threadId: thread._id
                }).sort({
                    timestamp: -1
                });

                return serializeThread(thread, latestMessage);
            })
        );

        res.json({
            success: true,
            threads: result
        });
    } catch (error) {
        console.error("Thread fetch error:", error);
        res.status(500).json({
            success: false,
            error: "Failed to load threads"
        });
    }
});

app.get("/api/threads/:threadId/messages", async (req, res) => {
    try {
        const threadId = req.params.threadId;

        if (!mongoose.Types.ObjectId.isValid(threadId)) {
            return res.status(400).json({
                success: false,
                error: "Invalid thread"
            });
        }

        const messages = await Message.find({
            threadId
        }).sort({
            timestamp: 1
        });

        res.json({
            success: true,
            messages: messages.map(serializeMessage)
        });
    } catch (error) {
        console.error("Message fetch error:", error);
        res.status(500).json({
            success: false,
            error: "Failed to load messages"
        });
    }
});

app.post("/api/threads/create", async (req, res) => {
    try {
        const isGroup = Boolean(req.body.isGroup);
        const groupName = String(req.body.groupName || "").trim();
        const creatorEmail = normalizeEmail(req.body.creatorEmail);

        let participants = Array.isArray(req.body.participants)
            ? req.body.participants.map(normalizeEmail).filter(Boolean)
            : [];

        if (creatorEmail) {
            participants.push(creatorEmail);
        }

        participants = [...new Set(participants)];

        if (participants.length < 2) {
            return res.status(400).json({
                success: false,
                error: "At least two participants are required"
            });
        }

        if (isGroup && !groupName) {
            return res.status(400).json({
                success: false,
                error: "Group name is required"
            });
        }

        const users = await User.find({
            email: {
                $in: participants
            }
        }).select("email");

        if (users.length !== participants.length) {
            return res.status(400).json({
                success: false,
                error: "One or more participants do not exist"
            });
        }

        if (!isGroup && participants.length === 2) {
            const existing = await Thread.findOne({
                isGroup: false,
                participants: {
                    $all: participants
                },
                $expr: {
                    $eq: [
                        {
                            $size: "$participants"
                        },
                        2
                    ]
                }
            });

            if (existing) {
                return res.json({
                    success: true,
                    threadId: existing._id.toString(),
                    thread: serializeThread(existing)
                });
            }
        }

        const thread = await new Thread({
            isGroup,
            groupName: isGroup ? groupName : "",
            participants,
            lastMessageAt: new Date()
        }).save();

        res.json({
            success: true,
            threadId: thread._id.toString(),
            thread: serializeThread(thread)
        });
    } catch (error) {
        console.error("Thread creation error:", error);
        res.status(500).json({
            success: false,
            error: "Failed to create thread"
        });
    }
});

app.post("/api/messages/send", async (req, res) => {
    try {
        const result = await createMessage(
            req.body.threadId,
            req.body.senderEmail,
            req.body.text
        );

        io.to(`thread:${req.body.threadId}`).emit(
            "chat_message",
            result.message
        );

        res.json({
            success: true,
            message: result.message
        });
    } catch (error) {
        console.error("Send message error:", error);
        res.status(400).json({
            success: false,
            error: error.message || "Failed to send message"
        });
    }
});

io.on("connection", socket => {
    socket.on("join_thread", async threadId => {
        try {
            if (!mongoose.Types.ObjectId.isValid(threadId)) {
                return;
            }

            socket.join(`thread:${threadId}`);
        } catch (error) {
            console.error("Join thread error:", error);
        }
    });

    socket.on("leave_thread", threadId => {
        socket.leave(`thread:${threadId}`);
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

    socket.on("chat_message", async data => {
        try {
            const result = await createMessage(
                data.threadId,
                data.senderEmail,
                data.text || data.message || data.content
            );

            io.to(`thread:${data.threadId}`).emit(
                "chat_message",
                result.message
            );
        } catch (error) {
            socket.emit("error", {
                message: error.message || "Failed to send message"
            });
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
