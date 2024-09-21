const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from the public directory
app.use(express.static('public'));

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

class ChatManager {
    constructor() {
        this.waitingUsers = [];
        this.activeChats = new Map();
    }

    addToWaiting(socket) {
        this.waitingUsers.push(socket);
        socket.emit('waiting', 'Waiting for a random stranger to connect...');
    }

    removeFromWaiting(socket) {
        this.waitingUsers = this.waitingUsers.filter(user => user !== socket);
    }

    matchUsers(user1, user2) {
        const chatId = `${user1.id}-${user2.id}`;
        this.activeChats.set(user1.id, { partner: user2, chatId });
        this.activeChats.set(user2.id, { partner: user1, chatId });
        [user1, user2].forEach(user => {
            user.join(chatId);
            user.emit('matched', 'You are now chatting with a random stranger.');
        });
        return chatId;
    }

    disconnectUser(socket) {
        const chatInfo = this.activeChats.get(socket.id);
        if (chatInfo) {
            const { partner, chatId } = chatInfo;
            partner.leave(chatId);
            partner.emit('disconnected', 'Stranger has disconnected.');
            this.activeChats.delete(partner.id);
            this.activeChats.delete(socket.id);
            this.addToWaiting(partner);
        }
        this.removeFromWaiting(socket);
    }

    findPartnerForUser(socket) {
        this.disconnectUser(socket);
        if (this.waitingUsers.length > 0) {
            const partner = this.waitingUsers.shift();
            const chatId = this.matchUsers(socket, partner);
            return chatId;
        } else {
            this.addToWaiting(socket);
            return null;
        }
    }
}

const chatManager = new ChatManager();

io.on('connection', (socket) => {
    console.log('New user connected:', socket.id);
    chatManager.findPartnerForUser(socket);

    socket.on('chat message', (msg) => {
        const chatInfo = chatManager.activeChats.get(socket.id);
        if (chatInfo) {
            socket.to(chatInfo.chatId).emit('chat message', msg);
        }
    });

    socket.on('media message', (data) => {
        const chatInfo = chatManager.activeChats.get(socket.id);
        if (chatInfo) {
            socket.to(chatInfo.chatId).emit('media message', data);
        }
    });

    socket.on('next', () => {
        chatManager.findPartnerForUser(socket);
    });

    socket.on('disconnect', () => {
        chatManager.disconnectUser(socket);
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
