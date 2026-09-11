const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Connect to MongoDB Atlas (Prevents the Freefids daily wipe!)
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://demo:demo@cluster.mongodb.net/cchat?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("Connected to Persistent MongoDB Atlas"))
    .catch(err => console.error("MongoDB connection error:", err));

// Message Schema so history is permanently saved
const messageSchema = new mongoose.Schema({
    username: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

app.get('/', (req, res) => {
    res.send("CCalculator / CChat Persistent Backend is live!");
});

// Fetch past messages on connection so nothing is lost
io.on('connection', async (socket) => {
    console.log(`User connected: ${socket.id}`);

    try {
        const pastMessages = await Message.find().sort({ timestamp: 1 }).limit(100);
        socket.emit('load_history', pastMessages);
    } catch (e) {
        console.error("Error loading history:", e);
    }

    socket.on('send_message', async (data) => {
        try {
            const newMessage = new Message({ username: data.username, text: data.text });
            await newMessage.save();
            io.emit('receive_message', newMessage);
        } catch (e) {
            console.error("Error saving message:", e);
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`CChat server running on port ${PORT}`);
});
