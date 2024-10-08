const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

class ChatManager {
    constructor() {
        this.waitingUsers = [];
        this.activeChats = new Map();
        this.totalUsers = 0;
        this.heartbeats = new Map();
    }

    addToWaiting(socket) {
        this.waitingUsers.push(socket);
        socket.emit('waiting', 'Waiting for a random stranger to connect...');
        this.updateUserCount();
    }

    removeFromWaiting(socket) {
        this.waitingUsers = this.waitingUsers.filter(user => user !== socket);
        this.updateUserCount();
    }

    matchUsers(user1, user2) {
        const chatId = `${user1.id}-${user2.id}`;
        this.activeChats.set(user1.id, { partner: user2, chatId });
        this.activeChats.set(user2.id, { partner: user1, chatId });
        [user1, user2].forEach(user => {
            user.join(chatId);
            user.emit('matched', 'You are now chatting with a random stranger.');
            this.startHeartbeat(user);
        });
        this.updateUserCount();
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
        this.stopHeartbeat(socket);
        this.updateUserCount();
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

    updateUserCount() {
        this.totalUsers = this.waitingUsers.length + this.activeChats.size;
        io.emit('user count', this.totalUsers);
    }

    reconnectUser(socket) {
        const chatInfo = this.activeChats.get(socket.id);
        if (chatInfo) {
            const { partner, chatId } = chatInfo;
            socket.join(chatId);
            socket.emit('reconnected', 'You have reconnected to your chat.');
            partner.emit('system message', 'Your chat partner has reconnected.');
            this.startHeartbeat(socket);
        } else {
            this.findPartnerForUser(socket);
        }
    }

    startHeartbeat(socket) {
        this.stopHeartbeat(socket);
        this.heartbeats.set(socket.id, setInterval(() => {
            socket.emit('heartbeat');
        }, 5000)); // Send heartbeat every 5 seconds
    }

    stopHeartbeat(socket) {
        const heartbeatInterval = this.heartbeats.get(socket.id);
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            this.heartbeats.delete(socket.id);
        }
    }

    handleMissedHeartbeat(socket) {
        console.log('Missed heartbeat from:', socket.id);
        this.disconnectUser(socket);
    }
}

const chatManager = new ChatManager();

io.on('connection', (socket) => {
    console.log('New user connected:', socket.id);
    chatManager.totalUsers++;
    chatManager.updateUserCount();
    chatManager.findPartnerForUser(socket);

    socket.on('rejoin', () => {
        chatManager.reconnectUser(socket);
    });

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

    socket.on('heartbeat-response', () => {
        // Reset the missed heartbeat counter when we receive a response
        chatManager.startHeartbeat(socket);
    });

    socket.on('disconnect', () => {
        chatManager.disconnectUser(socket);
        chatManager.totalUsers--;
        chatManager.updateUserCount();
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});