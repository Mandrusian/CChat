const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://demo:demo@cluster.mongodb.net/cchat?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("Connected to MongoDB Atlas"))
    .catch(err => console.error("MongoDB connection error:", err));

// User Schema
const userSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    passwordHash: { type: String, required: true },
    username: { type: String, default: "" },
    status: { type: String, default: "online" }
});
const User = mongoose.model('User', userSchema);

// Message Schema
const messageSchema = new mongoose.Schema({
    senderEmail: String,
    senderName: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// Seed Default Accounts
async function seedAccounts() {
    const defaultUsers = [
        { email: "x10zxc13@gmail.com", pass: "1223" },
        { email: "cybernoxal@gmail.com", pass: "cndaniel" },
        { email: "s3553@plc.qld.edu.au", pass: "s3553" }
    ];

    for (const u of defaultUsers) {
        const exists = await User.findOne({ email: u.email });
        if (!exists) {
            const hash = await bcrypt.hash(u.pass, 10);
            await new User({ email: u.email, passwordHash: hash }).save();
            console.log(`Seeded account: ${u.email}`);
        }
    }
}
mongoose.connection.once('open', seedAccounts);

// Authentication Endpoints
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    res.json({ success: true, email: user.email, username: user.username });
});

app.post('/api/set-username', async (req, res) => {
    const { email, username } = req.body;
    await User.updateOne({ email }, { username });
    res.json({ success: true });
});

app.get('/api/messages', async (req, res) => {
    const msgs = await Message.find().sort({ timestamp: 1 }).limit(100);
    res.json(msgs);
});

// Real-time Chat
io.on('connection', (socket) => {
    socket.on('send_message', async (data) => {
        const msg = new Message({
            senderEmail: data.email,
            senderName: data.username || data.email,
            text: data.text
        });
        await msg.save();
        io.emit('receive_message', msg);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`CChat server live on port ${PORT}`));
