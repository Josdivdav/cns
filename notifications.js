/**
 * notifications.js — Consy Notification System
 * =============================================
 * Creates a notification document in Firestore under the target user's
 * `notifications` sub-collection for every relevant action:
 *
 *  - post_like        → someone liked your post
 *  - post_comment     → someone commented on your post
 *  - comment_like     → someone liked your comment
 *  - comment_reply    → someone replied to your comment
 *  - friend_request   → someone sent you a friend request
 *  - request_accepted → your friend request was accepted
 *
 * Notification document shape (stored in users/{userDocId}/notifications):
 * {
 *   id:         string,          // auto-generated Firestore doc id
 *   type:       string,          // one of the types above
 *   fromUid:    string,          // portal ID / uid of the actor
 *   fromName:   string,          // display name of the actor
 *   fromAvatar: string | null,   // profile picture URL (if any)
 *   targetId:   string,          // postId / commentId / replyId (context)
 *   message:    string,          // human-readable description
 *   read:       boolean,         // false until the user opens notifications
 *   timestamp:  number           // Date.now()
 * }
 *
 * Real-time delivery: when a notification is created the server also emits
 * a Socket.IO event "new-notification" to all connected clients.  The
 * front-end should filter by the logged-in user's uid to show only theirs.
 */

const { db } = require("./admin.firebase.js");
const { getUserData } = require("./user.js");

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Resolve the Firestore document reference for a user by their portalID / uid.
 * Returns { ref, data } or null when not found.
 */
async function resolveUserDoc(identifier) {
    const usersRef = db.collection("users");

    // Try portalID first (students use this), then uid (used by contacts)
    let snap = await usersRef.where("portalID", "==", String(identifier)).limit(1).get();
    if (snap.empty) {
        snap = await usersRef.where("uid", "==", String(identifier)).limit(1).get();
    }
    if (snap.empty) return null;

    return { ref: snap.docs[0].ref, data: snap.docs[0].data() };
}

/**
 * Core function — writes one notification document to a user's sub-collection
 * and emits a Socket.IO event so the front-end can update instantly.
 *
 * @param {string|number} recipientId  - portalID or uid of the person to notify
 * @param {object}        payload      - notification fields (see shape above)
 * @param {object}        io           - Socket.IO server instance (optional)
 */
async function createNotification(recipientId, payload, io) {
    try {
        // Don't notify yourself
        if (String(recipientId) === String(payload.fromUid)) return;

        const recipient = await resolveUserDoc(recipientId);
        if (!recipient) {
            console.warn(`[Notifications] Recipient not found: ${recipientId}`);
            return;
        }

        const notifRef = recipient.ref.collection("notifications").doc();
        const notification = {
            id:         notifRef.id,
            type:       payload.type,
            fromUid:    payload.fromUid,
            fromName:   payload.fromName   || "Someone",
            fromAvatar: payload.fromAvatar || null,
            targetId:   payload.targetId   || null,
            message:    payload.message    || "",
            read:       false,
            timestamp:  Date.now()
        };

        await notifRef.set(notification);

        // Real-time push — all connected sockets filter by their own uid client-side
        if (io) {
            io.emit("new-notification", {
                recipientUid: recipient.data.uid || recipient.data.portalID,
                ...notification
            });
        }

        console.log(`[Notifications] ✓ ${payload.type} → ${recipient.data.name}`);
    } catch (err) {
        // Notification failures must never crash the main flow
        console.error("[Notifications] Error creating notification:", err.message);
    }
}

// ─────────────────────────────────────────────
// TRIGGER FUNCTIONS  (called from post.js / contact.js)
// ─────────────────────────────────────────────

/**
 * Called when a user likes a post.
 * @param {string} postId      - Firestore post document id
 * @param {string} likerPid    - portalID of the person who liked
 * @param {object} io
 */
async function notifyPostLike(postId, likerPid, io) {
    try {
        const postSnap = await db.collection("posts").doc(postId).get();
        if (!postSnap.exists) return;

        const post = postSnap.data();
        const ownerPid = post.portalID;

        // No self-notification
        if (String(ownerPid) === String(likerPid)) return;

        const liker = await getUserData(likerPid);

        await createNotification(ownerPid, {
            type:       "post_like",
            fromUid:    likerPid,
            fromName:   liker?.name || "Someone",
            fromAvatar: liker?.profilePicture || null,
            targetId:   postId,
            message:    `${liker?.name || "Someone"} liked your post`
        }, io);
    } catch (err) {
        console.error("[Notifications] notifyPostLike error:", err.message);
    }
}

/**
 * Called when a user comments on a post.
 * @param {string} postId       - the post being commented on
 * @param {string} commenterPid - portalID of the commenter
 * @param {string} commentId    - new comment's document id
 * @param {object} io
 */
async function notifyPostComment(postId, commenterPid, commentId, io) {
    try {
        const postSnap = await db.collection("posts").doc(postId).get();
        if (!postSnap.exists) return;

        const post = postSnap.data();
        const ownerPid = post.portalID;

        if (String(ownerPid) === String(commenterPid)) return;

        const commenter = await getUserData(commenterPid);

        await createNotification(ownerPid, {
            type:       "post_comment",
            fromUid:    commenterPid,
            fromName:   commenter?.name || "Someone",
            fromAvatar: commenter?.profilePicture || null,
            targetId:   postId,
            message:    `${commenter?.name || "Someone"} commented on your post`
        }, io);
    } catch (err) {
        console.error("[Notifications] notifyPostComment error:", err.message);
    }
}

/**
 * Called when a user likes a comment.
 * @param {string} commentId  - Firestore comment document id
 * @param {string} likerPid   - portalID of the person liking
 * @param {object} io
 */
async function notifyCommentLike(commentId, likerPid, io) {
    try {
        const commentSnap = await db.collection("comments").doc(commentId).get();
        if (!commentSnap.exists) return;

        const comment = commentSnap.data();
        const ownerPid = comment.portalID;

        if (String(ownerPid) === String(likerPid)) return;

        const liker = await getUserData(likerPid);

        await createNotification(ownerPid, {
            type:       "comment_like",
            fromUid:    likerPid,
            fromName:   liker?.name || "Someone",
            fromAvatar: liker?.profilePicture || null,
            targetId:   comment.postId,
            message:    `${liker?.name || "Someone"} liked your comment`
        }, io);
    } catch (err) {
        console.error("[Notifications] notifyCommentLike error:", err.message);
    }
}

/**
 * Called when a user replies to a comment.
 * @param {string} commentId   - the parent comment's id
 * @param {string} replierPid  - portalID of the person replying
 * @param {string} replyId     - new reply's document id
 * @param {object} io
 */
async function notifyCommentReply(commentId, replierPid, replyId, io) {
    try {
        const commentSnap = await db.collection("comments").doc(commentId).get();
        if (!commentSnap.exists) return;

        const comment = commentSnap.data();
        const ownerPid = comment.portalID;

        if (String(ownerPid) === String(replierPid)) return;

        const replier = await getUserData(replierPid);

        await createNotification(ownerPid, {
            type:       "comment_reply",
            fromUid:    replierPid,
            fromName:   replier?.name || "Someone",
            fromAvatar: replier?.profilePicture || null,
            targetId:   comment.postId,
            message:    `${replier?.name || "Someone"} replied to your comment`
        }, io);
    } catch (err) {
        console.error("[Notifications] notifyCommentReply error:", err.message);
    }
}

/**
 * Called when a friend request is sent.
 * @param {string} senderUid    - uid of the person sending the request
 * @param {string} receiverUid  - uid of the person receiving it
 * @param {object} io
 */
async function notifyFriendRequest(senderUid, receiverUid, io) {
    try {
        const usersRef = db.collection("users");
        const senderSnap = await usersRef.where("uid", "==", senderUid).limit(1).get();
        if (senderSnap.empty) return;

        const sender = senderSnap.docs[0].data();

        await createNotification(receiverUid, {
            type:       "friend_request",
            fromUid:    senderUid,
            fromName:   sender.name || "Someone",
            fromAvatar: sender.profilePicture || null,
            targetId:   senderUid,
            message:    `${sender.name || "Someone"} sent you a friend request`
        }, io);
    } catch (err) {
        console.error("[Notifications] notifyFriendRequest error:", err.message);
    }
}

/**
 * Called when a friend request is accepted.
 * @param {string} acceptorUid  - uid of the person who accepted
 * @param {string} requesterUid - uid of the person who originally sent the request
 * @param {object} io
 */
async function notifyRequestAccepted(acceptorUid, requesterUid, io) {
    try {
        const usersRef = db.collection("users");
        const acceptorSnap = await usersRef.where("uid", "==", acceptorUid).limit(1).get();
        if (acceptorSnap.empty) return;

        const acceptor = acceptorSnap.docs[0].data();

        await createNotification(requesterUid, {
            type:       "request_accepted",
            fromUid:    acceptorUid,
            fromName:   acceptor.name || "Someone",
            fromAvatar: acceptor.profilePicture || null,
            targetId:   acceptorUid,
            message:    `${acceptor.name || "Someone"} accepted your friend request`
        }, io);
    } catch (err) {
        console.error("[Notifications] notifyRequestAccepted error:", err.message);
    }
}

// ─────────────────────────────────────────────
// HTTP API ROUTES  (mounted by setupNotificationRoutes)
// ─────────────────────────────────────────────

/**
 * GET  /api/notifications          — fetch all notifications for a user
 * POST /api/notifications/read     — mark one notification as read
 * POST /api/notifications/read-all — mark all notifications as read
 * POST /api/notifications/delete   — delete a single notification
 * GET  /api/notifications/unread-count — get unread badge count
 */
function setupNotificationRoutes(app, io) {

    // ── Fetch all notifications ──────────────────────────────────────────
    app.post("/api/notifications", async (req, res) => {
        try {
            const { uid } = req.body;
            if (!uid) return res.status(400).json({ success: false, message: "uid required" });

            const user = await resolveUserDoc(uid);
            if (!user) return res.status(404).json({ success: false, message: "User not found" });

            const snap = await user.ref
                .collection("notifications")
                .orderBy("timestamp", "desc")
                .limit(50)
                .get();

            const notifications = snap.docs.map(d => d.data());
            res.json({ success: true, notifications });
        } catch (err) {
            console.error("[Notifications] fetch error:", err);
            res.status(500).json({ success: false, message: "Server error" });
        }
    });

    // ── Unread count (for the bell badge) ───────────────────────────────
    app.post("/api/notifications/unread-count", async (req, res) => {
        try {
            const { uid } = req.body;
            if (!uid) return res.status(400).json({ success: false, message: "uid required" });

            const user = await resolveUserDoc(uid);
            if (!user) return res.status(404).json({ success: false, message: "User not found" });

            const snap = await user.ref
                .collection("notifications")
                .where("read", "==", false)
                .get();

            res.json({ success: true, count: snap.size });
        } catch (err) {
            console.error("[Notifications] unread-count error:", err);
            res.status(500).json({ success: false, message: "Server error" });
        }
    });

    // ── Mark one as read ─────────────────────────────────────────────────
    app.post("/api/notifications/read", async (req, res) => {
        try {
            const { uid, notificationId } = req.body;
            if (!uid || !notificationId)
                return res.status(400).json({ success: false, message: "uid and notificationId required" });

            const user = await resolveUserDoc(uid);
            if (!user) return res.status(404).json({ success: false, message: "User not found" });

            await user.ref.collection("notifications").doc(notificationId).update({ read: true });

            res.json({ success: true });
        } catch (err) {
            console.error("[Notifications] read error:", err);
            res.status(500).json({ success: false, message: "Server error" });
        }
    });

    // ── Mark ALL as read ─────────────────────────────────────────────────
    app.post("/api/notifications/read-all", async (req, res) => {
        try {
            const { uid } = req.body;
            if (!uid) return res.status(400).json({ success: false, message: "uid required" });

            const user = await resolveUserDoc(uid);
            if (!user) return res.status(404).json({ success: false, message: "User not found" });

            const snap = await user.ref
                .collection("notifications")
                .where("read", "==", false)
                .get();

            const batch = db.batch();
            snap.docs.forEach(doc => batch.update(doc.ref, { read: true }));
            await batch.commit();

            // Tell the client to clear their badge
            if (io) {
                io.emit("notifications-cleared", { uid: user.data.uid || user.data.portalID });
            }

            res.json({ success: true, updated: snap.size });
        } catch (err) {
            console.error("[Notifications] read-all error:", err);
            res.status(500).json({ success: false, message: "Server error" });
        }
    });

    // ── Delete a single notification ─────────────────────────────────────
    app.post("/api/notifications/delete", async (req, res) => {
        try {
            const { uid, notificationId } = req.body;
            if (!uid || !notificationId)
                return res.status(400).json({ success: false, message: "uid and notificationId required" });

            const user = await resolveUserDoc(uid);
            if (!user) return res.status(404).json({ success: false, message: "User not found" });

            await user.ref.collection("notifications").doc(notificationId).delete();

            res.json({ success: true });
        } catch (err) {
            console.error("[Notifications] delete error:", err);
            res.status(500).json({ success: false, message: "Server error" });
        }
    });
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
module.exports = {
    setupNotificationRoutes,
    // Trigger helpers — import these wherever the action happens
    notifyPostLike,
    notifyPostComment,
    notifyCommentLike,
    notifyCommentReply,
    notifyFriendRequest,
    notifyRequestAccepted
};
