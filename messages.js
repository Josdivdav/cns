const { db, admin } = require("./admin.firebase.js");
const { getUserData } = require("./user.js");

// ============================================
// SEND MESSAGE (with Reply Support)
// ============================================
async function sendMessage(app, io) {
    app.post("/api/messages/send-message", async (req, res) => {
        try {
            const { senderId, receiverId, message, roomId, timestamp, replyTo } = req.body;

            // Validate input
            if (!senderId || !receiverId || !message || !roomId) {
                return res.status(400).json({
                    success: false,
                    message: "Missing required fields"
                });
            }

            const messagesRef = db.collection("messages");
            const messageId = messagesRef.doc().id;

            // Create message document
            const messageData = {
                id: messageId,
                senderId: senderId,
                receiverId: receiverId,
                message: message,
                roomId: roomId,
                timestamp: timestamp || Date.now(),
                status: "sent",
                readBy: [],
                isEdited: false
            };

            // Add reply data if this is a reply
            if (replyTo) {
                messageData.replyTo = {
                    id: replyTo.id,
                    message: replyTo.message || replyTo.text,
                    senderId: replyTo.senderId,
                    senderName: replyTo.senderName
                };
            }

            await messagesRef.doc(messageId).set(messageData);

            res.json({
                success: true,
                messageId: messageId,
                message: "Message sent successfully"
            });

        } catch (error) {
            console.error("Error sending message:", error);
            res.status(500).json({
                success: false,
                message: "Server error"
            });
        }
    });
}

// ============================================
// EDIT MESSAGE
// ============================================
async function editMessage(app, io) {
    app.post("/api/messages/edit-message", async (req, res) => {
        try {
            const { messageId, userId, newText } = req.body;

            // Validate input
            if (!messageId || !userId || !newText) {
                return res.status(400).json({
                    success: false,
                    message: "Missing required fields"
                });
            }

            const messageRef = db.collection("messages").doc(messageId);
            const messageDoc = await messageRef.get();

            // Check if message exists
            if (!messageDoc.exists) {
                return res.status(404).json({
                    success: false,
                    message: "Message not found"
                });
            }

            const messageData = messageDoc.data();

            // Verify user is the sender
            if (messageData.senderId !== userId) {
                return res.status(403).json({
                    success: false,
                    message: "You can only edit your own messages"
                });
            }

            // Don't allow editing deleted messages
            if (messageData.deleted) {
                return res.status(400).json({
                    success: false,
                    message: "Cannot edit deleted message"
                });
            }

            // Store original message in history
            const originalMessage = messageData.message;
            const editHistory = messageData.editHistory || [];
            editHistory.push({
                text: originalMessage,
                editedAt: Date.now()
            });

            // Update message
            await messageRef.update({
                message: newText,
                isEdited: true,
                editedAt: Date.now(),
                editHistory: editHistory
            });

            // Emit socket event for real-time update
            if (io) {
                io.to(messageData.roomId).emit("message-edited", {
                    messageId: messageId,
                    roomId: messageData.roomId,
                    newText: newText
                });
            }

            res.json({
                success: true,
                message: "Message edited successfully"
            });

        } catch (error) {
            console.error("Error editing message:", error);
            res.status(500).json({
                success: false,
                message: "Server error"
            });
        }
    });
}

// ============================================
// GET MESSAGES (CHAT HISTORY)
// No Firebase index required - sorts in memory
// ============================================
async function getMessages(app) {
    app.post("/api/messages/get-messages", async (req, res) => {
        try {
            const { userId, friendId } = req.body;

            if (!userId || !friendId) {
                return res.status(400).json({
                    success: false,
                    message: "Missing userId or friendId"
                });
            }

            // Create room ID (sorted UIDs)
            const sortedIds = [userId, friendId].sort();
            const roomId = `chat_${sortedIds[0]}_${sortedIds[1]}`;

            const messagesRef = db.collection("messages");
            
            // Query without orderBy to avoid needing composite index
            const query = messagesRef.where("roomId", "==", roomId);

            const snapshot = await query.get();

            if (snapshot.empty) {
                return res.json({
                    success: true,
                    messages: []
                });
            }

            // Filter out deleted messages and sort in memory
            const messages = snapshot.docs
                .map(doc => doc.data())
                .filter(msg => !msg.deleted) // Exclude deleted messages
                .sort((a, b) => a.timestamp - b.timestamp) // Sort ascending by timestamp
                .slice(-100); // Keep only last 100 messages

            res.json({
                success: true,
                messages: messages
            });

        } catch (error) {
            console.error("Error getting messages:", error);
            res.status(500).json({
                success: false,
                message: "Server error"
            });
        }
    });
}

// ============================================
// GET MESSAGE EDIT HISTORY
// ============================================
async function getEditHistory(app) {
    app.post("/api/messages/get-edit-history", async (req, res) => {
        try {
            const { messageId } = req.body;

            if (!messageId) {
                return res.status(400).json({
                    success: false,
                    message: "Missing messageId"
                });
            }

            const messageRef = db.collection("messages").doc(messageId);
            const messageDoc = await messageRef.get();

            if (!messageDoc.exists) {
                return res.status(404).json({
                    success: false,
                    message: "Message not found"
                });
            }

            const messageData = messageDoc.data();

            res.json({
                success: true,
                editHistory: messageData.editHistory || [],
                currentMessage: messageData.message,
                isEdited: messageData.isEdited || false
            });

        } catch (error) {
            console.error("Error getting edit history:", error);
            res.status(500).json({
                success: false,
                message: "Server error"
            });
        }
    });
}

// ============================================
// MARK MESSAGE AS READ
// ============================================
async function markAsRead(app, io) {
    app.post("/api/messages/mark-read", async (req, res) => {
        try {
            const { messageId, userId } = req.body;

            if (!messageId || !userId) {
                return res.status(400).json({
                    success: false,
                    message: "Missing messageId or userId"
                });
            }

            const messageRef = db.collection("messages").doc(messageId);
            const messageDoc = await messageRef.get();

            if (!messageDoc.exists) {
                return res.status(404).json({
                    success: false,
                    message: "Message not found"
                });
            }

            // Update message status
            await messageRef.update({
                status: "read",
                readBy: admin.firestore.FieldValue.arrayUnion(userId),
                readAt: Date.now()
            });

            res.json({
                success: true,
                message: "Message marked as read"
            });

        } catch (error) {
            console.error("Error marking message as read:", error);
            res.status(500).json({
                success: false,
                message: "Server error"
            });
        }
    });
}

// ============================================
// GET UNREAD COUNT
// ============================================
async function getUnreadCount(app) {
    app.post("/api/messages/get-unread-count", async (req, res) => {
        try {
            const { userId, friendId } = req.body;

            if (!userId || !friendId) {
                return res.status(400).json({
                    success: false,
                    message: "Missing userId or friendId"
                });
            }

            const messagesRef = db.collection("messages");
            const query = messagesRef
                .where("receiverId", "==", userId)
                .where("senderId", "==", friendId)
                .where("status", "!=", "read");

            const snapshot = await query.get();
            const unreadCount = snapshot.size;

            res.json({
                success: true,
                unreadCount: unreadCount
            });

        } catch (error) {
            console.error("Error getting unread count:", error);
            res.status(500).json({
                success: false,
                message: "Server error"
            });
        }
    });
}

// ============================================
// GET LAST MESSAGE FOR CHAT ENTRY
// ============================================
async function getLastMessage(app) {
    app.post("/api/messages/get-last-message", async (req, res) => {
        try {
            const { userId, friendId } = req.body;

            if (!userId || !friendId) {
                return res.status(400).json({
                    success: false,
                    message: "Missing userId or friendId"
                });
            }

            // Create room ID
            const sortedIds = [userId, friendId].sort();
            const roomId = `chat_${sortedIds[0]}_${sortedIds[1]}`;

            const messagesRef = db.collection("messages");
            const query = messagesRef
                .where("roomId", "==", roomId)
                .orderBy("timestamp", "desc")
                .limit(1);

            const snapshot = await query.get();

            if (snapshot.empty) {
                return res.json({
                    success: true,
                    lastMessage: null
                });
            }

            const lastMessage = snapshot.docs[0].data();

            res.json({
                success: true,
                lastMessage: {
                    message: lastMessage.message,
                    timestamp: lastMessage.timestamp,
                    senderId: lastMessage.senderId,
                    isEdited: lastMessage.isEdited || false
                }
            });

        } catch (error) {
            console.error("Error getting last message:", error);
            res.status(500).json({
                success: false,
                message: "Server error"
            });
        }
    });
}

// ============================================
// DELETE MESSAGE
// ============================================
async function deleteMessage(app, io) {
    app.post("/api/messages/delete-message", async (req, res) => {
        try {
            const { messageId, userId } = req.body;

            if (!messageId || !userId) {
                return res.status(400).json({
                    success: false,
                    message: "Missing messageId or userId"
                });
            }

            const messageRef = db.collection("messages").doc(messageId);
            const messageDoc = await messageRef.get();

            if (!messageDoc.exists) {
                return res.status(404).json({
                    success: false,
                    message: "Message not found"
                });
            }

            const messageData = messageDoc.data();

            // Only sender can delete their own message
            if (messageData.senderId !== userId) {
                return res.status(403).json({
                    success: false,
                    message: "Unauthorized"
                });
            }

            // Soft delete - just mark as deleted
            await messageRef.update({
                deleted: true,
                deletedAt: Date.now()
            });

            // Emit socket event for real-time update
            if (io) {
                io.to(messageData.roomId).emit("message-deleted", {
                    messageId: messageId,
                    roomId: messageData.roomId
                });
            }

            res.json({
                success: true,
                message: "Message deleted"
            });

        } catch (error) {
            console.error("Error deleting message:", error);
            res.status(500).json({
                success: false,
                message: "Server error"
            });
        }
    });
}

// ============================================
// SOCKET.IO EVENTS HANDLER
// ============================================
function setupSocketEvents(io) {
    io.on("connection", (socket) => {
        console.log("User connected to chat:", socket.id);

        // Join chat room
        socket.on("join-chat", (data) => {
            const { roomId, userId, friendId } = data;
            socket.join(roomId);
            console.log(`User ${userId} joined room ${roomId}`);

            // Notify friend that user is online
            socket.to(roomId).emit("user-joined", {
                userId: userId,
                roomId: roomId
            });
        });

        // Leave chat room
        socket.on("leave-chat", (data) => {
            const { roomId, userId } = data;
            socket.leave(roomId);
            console.log(`User ${userId} left room ${roomId}`);

            // Notify friend that user left
            socket.to(roomId).emit("user-left", {
                userId: userId,
                roomId: roomId
            });
        });

        // Send message (with reply support)
        socket.on("send-message", (data) => {
            const { roomId, messageId, senderId, receiverId, message, timestamp, replyTo } = data;
            
            // Broadcast to room (except sender)
            socket.to(roomId).emit("receive-message", {
                messageId: messageId,
                roomId: roomId,
                senderId: senderId,
                receiverId: receiverId,
                message: message,
                timestamp: timestamp,
                replyTo: replyTo, // Include reply data
                isEdited: false
            });

            console.log(`Message sent in room ${roomId}:`, message);
        });

        // Edit message
        socket.on("edit-message", (data) => {
            const { messageId, roomId, newText } = data;
            
            // Broadcast edit to room (except sender)
            socket.to(roomId).emit("message-edited", {
                messageId: messageId,
                roomId: roomId,
                newText: newText
            });

            console.log(`Message edited in room ${roomId}:`, messageId);
        });

        // Delete message
        socket.on("delete-message", (data) => {
            const { messageId, roomId } = data;
            
            // Broadcast delete to room (except sender)
            socket.to(roomId).emit("message-deleted", {
                messageId: messageId,
                roomId: roomId
            });

            console.log(`Message deleted in room ${roomId}:`, messageId);
        });

        // Typing indicator
        socket.on("typing", (data) => {
            const { roomId, userId, friendId } = data;
            socket.to(roomId).emit("friend-typing", {
                roomId: roomId,
                userId: userId
            });
        });

        // Stop typing
        socket.on("stop-typing", (data) => {
            const { roomId, userId, friendId } = data;
            socket.to(roomId).emit("friend-stopped-typing", {
                roomId: roomId,
                userId: userId
            });
        });

        // Message delivered
        socket.on("message-delivered", (data) => {
            const { messageId, roomId, userId } = data;
            socket.to(roomId).emit("message-delivered", {
                messageId: messageId,
                roomId: roomId
            });
        });

        // Message read
        socket.on("message-read", (data) => {
            const { messageId, roomId, userId } = data;
            socket.to(roomId).emit("message-read", {
                messageId: messageId,
                roomId: roomId
            });
        });

        // Disconnect
        socket.on("disconnect", () => {
            console.log("User disconnected from chat:", socket.id);
        });
    });
}

// ============================================
// REGISTER ALL ROUTES
// ============================================
function setupMessageRoutes(app, io) {
    sendMessage(app, io);
    editMessage(app, io);
    getMessages(app);
    getEditHistory(app);
    markAsRead(app, io);
    getUnreadCount(app);
    getLastMessage(app);
    deleteMessage(app, io);
}

module.exports = {
    setupMessageRoutes,
    setupSocketEvents,
    sendMessage,
    editMessage,
    getMessages,
    getEditHistory,
    markAsRead,
    getUnreadCount,
    getLastMessage,
    deleteMessage
};
