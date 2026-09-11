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

const userSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    passwordHash: { type: String, required: true },
    username: { type: String, default: "" }
});
const User = mongoose.model('User', userSchema);

// Seed Accounts
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

// Authentication & Registration Endpoints
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ success: false, error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ success: false, error: "Invalid credentials" });

    res.json({ success: true, email: user.email, username: user.username });
});

app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ success: false, error: "User exists" });

    const hash = await bcrypt.hash(password, 10);
    await new User({ email, passwordHash: hash }).save();
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
