const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://demo:demo@cluster.mongodb.net/cchat?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("Connected to MongoDB Atlas"))
    .catch(err => console.error("MongoDB connection error:", err));

// Schemas
const userSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    passwordHash: { type: String, required: true },
    username: { type: String, default: "" }
});

const threadSchema = new mongoose.Schema({
    isGroup: { type: Boolean, default: false },
    groupName: { type: String, default: "" },
    participants: [{ type: String }], // Array of emails
    lastMessageAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
    threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Thread', required: true },
    senderEmail: { type: String, required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Thread = mongoose.model('Thread', threadSchema);
const Message = mongoose.model('Message', messageSchema);

// Auth Routes
const handleLogin = async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ success: false, error: "Invalid credentials" });
    }
    res.json({ success: true, email: user.email, username: user.username });
};

const handleRegister = async (req, res) => {
    const { email, password } = req.body;
    if (await User.findOne({ email })) return res.status(400).json({ success: false, error: "User exists" });
    const hash = await bcrypt.hash(password, 10);
    await new User({ email, passwordHash: hash }).save();
    res.json({ success: true });
};

app.post('/api/login', handleLogin);
app.post('/api/register', handleRegister);

// Chat Routes
app.post('/api/threads/create', async (req, res) => {
    const { isGroup, groupName, participants } = req.body;
    const thread = new Thread({ isGroup, groupName, participants });
    await thread.save();
    res.json({ success: true, threadId: thread._id });
});

app.post('/api/messages/send', async (req, res) => {
    const { threadId, senderEmail, text } = req.body;
    const msg = new Message({ threadId, senderEmail, text });
    await msg.save();
    await Thread.findByIdAndUpdate(threadId, { lastMessageAt: Date.now() });
    res.json({ success: true, message: msg });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
