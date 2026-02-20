const { db, admin } = require("./admin.firebase.js");
const { getUserDataC } = require("./user.js");

async function getRequest(app) {
    app.post("/api/contact/get-requests", async (req, res) => {
        try {
            const { uid } = req.body;
            
            // Validate uid
            if (!uid) {
                return res.status(400).json({
                    success: false,
                    message: "Missing uid parameter"
                });
            }
            
            const usersRef = db.collection("users");
            const userSnap = await usersRef.where("uid", "==", uid).limit(1).get();
            if (userSnap.empty) return res.send([]);
            const user = userSnap.docs[0].data();
            const requests = user.friendRequest || [];
            if (!requests.length) return res.send([]);
            const allUsersSnap = await usersRef.where("uid", "in", requests).get();
            const users = allUsersSnap.docs.map(d => d.data());
            res.send(users);
        } catch (error) {
            console.error("Error in getRequest:", error);
            res.status(500).json({
                success: false,
                message: "Server error"
            });
        }
    });
}

async function sendRequest(app) {
    app.post("/api/contact/send-request", async (req, res) => {
        try {
            const { sid, uid } = req.body;
            if (!sid || !uid) {
                return res
                    .status(400)
                    .send({ success: false, message: "Missing data" });
            }
            const usersRef = db.collection("users");
            // Sender
            const senderSnap = await usersRef
                .where("uid", "==", sid)
                .limit(1)
                .get();
            if (senderSnap.empty) {
                return res
                    .status(404)
                    .send({ success: false, message: "Sender not found" });
            }
            const senderDoc = senderSnap.docs[0];
            const senderRef = senderDoc.ref;
            const senderData = senderDoc.data();
            // Receiver
            const receiverSnap = await usersRef
                .where("uid", "==", uid)
                .limit(1)
                .get();
            if (receiverSnap.empty) {
                return res
                    .status(404)
                    .send({ success: false, message: "Receiver not found" });
            }
            const receiverDoc = receiverSnap.docs[0];
            const receiverRef = receiverDoc.ref;
            const receiverData = receiverDoc.data();
            const senderSent = senderData.friendRequestSent || [];
            const receiverRequests = receiverData.friendRequest || [];
            // stop duplicates
            if (senderSent.includes(uid) || receiverRequests.includes(sid)) {
                return res.send({
                    success: false,
                    message: "Request already sent"
                });
            }

            // update both sides
            await Promise.all([
                senderRef.update({
                    friendRequestSent: [...senderSent, uid]
                }),
                receiverRef.update({
                    friendRequest: [...receiverRequests, sid]
                })
            ]);

            res.send({ success: true, message: "Request sent" });
        } catch (err) {
            console.error(err);
            res.status(500).send({ success: false, message: "Server error" });
        }
    });
}

// ============================================
// ACCEPT FRIEND REQUEST
// ============================================
async function acceptRequest(app, io) {
    app.post("/api/contact/accept-request", async (req, res) => {
        try {
            const { userId, requestId } = req.body;

            // Validate input
            if (!userId || !requestId) {
                return res.status(400).send({
                    success: false,
                    message: "Missing userId or requestId"
                });
            }

            const usersRef = db.collection("users");

            // Get the user who is accepting the request (receiver)
            const userSnap = await usersRef
                .where("uid", "==", userId)
                .limit(1)
                .get();

            if (userSnap.empty) {
                return res.status(404).send({
                    success: false,
                    message: "User not found"
                });
            }

            const userDoc = userSnap.docs[0];
            const userRef = userDoc.ref;
            const userData = userDoc.data();

            // Get the user who sent the request (sender)
            const requesterSnap = await usersRef
                .where("uid", "==", requestId)
                .limit(1)
                .get();

            if (requesterSnap.empty) {
                return res.status(404).send({
                    success: false,
                    message: "Requester not found"
                });
            }

            const requesterDoc = requesterSnap.docs[0];
            const requesterRef = requesterDoc.ref;
            const requesterData = requesterDoc.data();

            // Get current arrays
            const userRequests = userData.friendRequest || [];
            const userFriends = userData.friendsList || [];
            const requesterSent = requesterData.friendRequestSent || [];
            const requesterFriends = requesterData.friendsList || [];

            // Verify the request exists
            if (!userRequests.includes(requestId)) {
                return res.status(400).send({
                    success: false,
                    message: "Friend request not found"
                });
            }

            // Check if already friends (safety check)
            if (userFriends.includes(requestId) || requesterFriends.includes(userId)) {
                return res.status(400).send({
                    success: false,
                    message: "Already friends"
                });
            }

            // Update both users:
            // 1. Remove from friendRequest array (receiver)
            // 2. Remove from friendRequestSent array (sender)
            // 3. Add to friendsList array (both)
            await Promise.all([
                // Update receiver (user accepting)
                userRef.update({
                    friendRequest: admin.firestore.FieldValue.arrayRemove(requestId),
                    friendsList: admin.firestore.FieldValue.arrayUnion(requestId)
                }),
                // Update sender (user who sent request)
                requesterRef.update({
                    friendRequestSent: admin.firestore.FieldValue.arrayRemove(userId),
                    friendsList: admin.firestore.FieldValue.arrayUnion(userId)
                })
            ]);

            // Emit real-time update to both users if io is available
            if (io) {
                io.emit("friend-request-accepted", {
                    userId: userId,
                    friendId: requestId,
                    timestamp: new Date().getTime()
                });
            }

            res.send({
                success: true,
                message: "Friend request accepted",
                newFriend: {
                    uid: requesterData.uid,
                    name: requesterData.name,
                    email: requesterData.email
                }
            });
        } catch (err) {
            console.error("Error accepting request:", err);
            res.status(500).send({
                success: false,
                message: "Server error"
            });
        }
    });
}

async function rejectRequest(app, io) {
    app.post("/api/contact/reject-request", async (req, res) => {
        try {
            const { userId, requestId } = req.body;

            // Validate input
            if (!userId || !requestId) {
                return res.status(400).send({
                    success: false,
                    message: "Missing userId or requestId"
                });
            }

            const usersRef = db.collection("users");

            // Get the user who is rejecting the request (receiver)
            const userSnap = await usersRef
                .where("uid", "==", userId)
                .limit(1)
                .get();

            if (userSnap.empty) {
                return res.status(404).send({
                    success: false,
                    message: "User not found"
                });
            }

            const userDoc = userSnap.docs[0];
            const userRef = userDoc.ref;
            const userData = userDoc.data();

            // Get the user who sent the request (sender)
            const requesterSnap = await usersRef
                .where("uid", "==", requestId)
                .limit(1)
                .get();

            if (requesterSnap.empty) {
                return res.status(404).send({
                    success: false,
                    message: "Requester not found"
                });
            }

            const requesterDoc = requesterSnap.docs[0];
            const requesterRef = requesterDoc.ref;

            // Get current arrays
            const userRequests = userData.friendRequest || [];

            // Verify the request exists
            if (!userRequests.includes(requestId)) {
                return res.status(400).send({
                    success: false,
                    message: "Friend request not found"
                });
            }

            // Update both users:
            // 1. Remove from friendRequest array (receiver)
            // 2. Remove from friendRequestSent array (sender)
            await Promise.all([
                userRef.update({
                    friendRequest: admin.firestore.FieldValue.arrayRemove(requestId)
                }),
                requesterRef.update({
                    friendRequestSent: admin.firestore.FieldValue.arrayRemove(userId)
                })
            ]);

            // Emit real-time update if io is available
            if (io) {
                io.emit("friend-request-rejected", {
                    userId: userId,
                    requestId: requestId,
                    timestamp: new Date().getTime()
                });
            }

            res.send({
                success: true,
                message: "Friend request rejected"
            });
        } catch (err) {
            console.error("Error rejecting request:", err);
            res.status(500).send({
                success: false,
                message: "Server error"
            });
        }
    });
}

// ============================================
// GET FRIENDS LIST
// ============================================
async function getFriendsList(app) {
    app.post("/api/contact/get-friends", async (req, res) => {
        try {
            const { uid } = req.body;

            if (!uid) {
                return res.status(400).send({
                    success: false,
                    message: "Missing uid"
                });
            }

            const usersRef = db.collection("users");
            const userSnap = await usersRef.where("uid", "==", uid).limit(1).get();

            if (userSnap.empty) {
                return res.status(404).send({
                    success: false,
                    message: "User not found"
                });
            }

            const user = userSnap.docs[0].data();
            const friendsList = user.friendsList || [];

            if (!friendsList.length) {
                return res.send([]);
            }

            // Fetch all friends' data
            const friendsSnap = await usersRef.where("uid", "in", friendsList).get();
            const friends = friendsSnap.docs.map(d => d.data());

            res.send(friends);
        } catch (err) {
            console.error("Error getting friends list:", err);
            res.status(500).send({
                success: false,
                message: "Server error"
            });
        }
    });
}

async function getAllUsersNotFriends(app, io) {
    // Register accept and reject endpoints
    acceptRequest(app, io);
    rejectRequest(app, io);
    getFriendsList(app);

    app.post("/api/contact/users-list", async (req, res) => {
        try {
            const { mainUserId } = req.body;
            
            // Validate mainUserId
            if (!mainUserId) {
                return res.status(400).json({
                    success: false,
                    message: "Missing mainUserId parameter"
                });
            }
            
            const usersRef = db.collection("users");

            // get main user
            const userSnap = await usersRef
                .where("uid", "==", mainUserId)
                .limit(1)
                .get();

            if (userSnap.empty) {
                return res.status(404).send("User not found");
            }

            const mainUser = userSnap.docs[0].data();

            const myFriends = mainUser.friendsList || [];
            const myRequests = mainUser.friendRequest || [];
            const mySentRequests = mainUser.friendRequestSent || [];

            // get all other users
            const allUsersSnap = await usersRef
                .where("uid", "!=", mainUserId)
                .get();

            const filteredUsers = allUsersSnap.docs
                .map(doc => doc.data())
                .filter(user => {
                    const theirFriends = user.friendsList || [];
                    const theirRequests = user.friendRequest || [];

                    return (
                        !myFriends.includes(user.uid) &&
                        !myRequests.includes(user.uid) &&
                        !mySentRequests.includes(user.uid) &&
                        !theirFriends.includes(mainUserId) &&
                        !theirRequests.includes(mainUserId)
                    );
                });

            res.send(filteredUsers);
        } catch (err) {
            console.error(err);
            res.status(500).send("Server error");
        }
    });
}

module.exports = {
    sendRequest,
    getAllUsersNotFriends,
    getRequest,
    acceptRequest,
    rejectRequest,
    getFriendsList
};
