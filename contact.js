const { db, admin } = require("./admin.firebase.js");
const { getUserDataC } = require("./user.js");

async function getRequest(app) {
    app.post("/api/contact/get-requests", async (req, res) => {
        const { uid } = req.body;

        const usersRef = db.collection("users");

        const userSnap = await usersRef.where("uid", "==", uid).limit(1).get();
        if (userSnap.empty) return res.send([]);

        const user = userSnap.docs[0].data();
        const requests = user.friendRequest || [];

        if (!requests.length) return res.send([]);

        const allUsersSnap = await usersRef.where("uid", "in", requests).get();

        const users = allUsersSnap.docs.map(d => d.data());

        res.send(users);
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

async function getAllUsersNotFriends(app) {
    app.post("/api/contact/users-list", async (req, res) => {
        try {
            const { mainUserId } = req.body;

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
    getRequest
};
