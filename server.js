const socketServer = require("socket.io");
const cors = require("cors");
const express = require("express");
const app = express();
app.use(express.json());
const http = require("http").createServer(app);
const nodemailer = require("nodemailer");
const { jwt } = require("jsonwebtoken");
const { db, secret_key, mailings } = require("./admin.firebase.js");
const { generateToken, verifyToken } = require("./jwt.utils.js");
const {
    verifyAndCreateUser,
    verifyAndLogUserIn
} = require("./firebase.auth.js");
const { getUserData, getUsers } = require("./user.js");
const { 
  setupUserProfileRoutes,
  updateUserProfile,
  getUserProfile,
  uploadProfilePicture
} = require("./user_profile.js");
const {
    getPost,
    setup,
    createComment,
    fetchComments,
    createReply,
    fetchReplies,
    createPost,
    reactionControlLike
} = require("./post.js");
const { sendRequest, getAllUsersNotFriends, getRequest } = require("./contact.js");
const { svn } = require("./svns/consy-svn.js");
const { lvn } = require("./svns/lvn.js");
const { createLecturer, signin } = require("./lecturer/auth.js");
const { setupMessageRoutes, setupSocketEvents } = require("./messages.js");

const { setupNotificationRoutes } = require("./notifications.js");

const { setupUploadProfileImage } = require("./uploadProfileImage.js");
const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "uploads/"); // Folder to save files
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname)); // Unique filename
    }
});
const upload = multer({ storage: storage });

const { key, user } = mailings;
app.use(cors());
app.use("/uploads", express.static("uploads"));
app.use("/profile-images/", express.static("public/profile-images"));
const io = socketServer(http, { cors: { origin: "*" } });
const authenticateSocket = (socket, next) => {
    const token = socket.handshake.auth.token;
    const decoded = verifyToken(token, secret_key);
    if (!decoded) {
        socket.disconnect();
        return next(new Error("Unauthorized"));
    }
    socket.user = decoded;
    next();
};

io.use(authenticateSocket);

// ── uid → socketId map so we can target specific users ──────────────────────
const onlineUsers = {};

io.on("connection", socket => {

    // Every page registers the logged-in user on socket connect
    socket.on("register-user", (uid) => {
        onlineUsers[uid] = socket.id;
        console.log("register-user:", uid, "->", socket.id);
    });

    // ── Call signalling ──────────────────────────────────────────────────────

    // Caller emits this after their PeerJS peer opens
    // data = { targetUid, callerUid, callerName, callType, roomId, peerId }
    socket.on("incoming-call", (data) => {
        const targetSocket = onlineUsers[data.targetUid];
        if (targetSocket) {
            io.to(targetSocket).emit("incoming-call", data);
        }
    });

    // Callee accepted — tell the caller
    // data = { callerUid, calleeUid, roomId }
    socket.on("call-accepted", (data) => {
        const callerSocket = onlineUsers[data.callerUid];
        if (callerSocket) {
            io.to(callerSocket).emit("call-accepted", data);
        }
    });

    // Callee rejected — tell the caller
    // data = { callerUid }
    socket.on("call-rejected", (data) => {
        const callerSocket = onlineUsers[data.callerUid];
        if (callerSocket) {
            io.to(callerSocket).emit("call-rejected");
        }
    });

    // PeerJS room events — same pattern as template
    socket.on("join-room", (roomId, peerId) => {
        socket.join(roomId);
        socket.to(roomId).emit("user-connected", peerId);
        console.log("join-room:", roomId, "peerId:", peerId);
    });

    socket.on("call-ended", (roomId) => {
        socket.to(roomId).emit("call-ended");
        console.log("call-ended room:", roomId);
    });

    socket.on("leave-room", (roomId) => {
        socket.leave(roomId);
        socket.to(roomId).emit("user-disconnected", socket.id);
    });

    // ── Existing events ──────────────────────────────────────────────────────

    socket.on("authenticate", async (r) => {
        const token = socket.handshake.auth.token;
        const rs = verifyToken(token, secret_key);
        if(!rs) return;
        const uid = rs.uid;
        if (!uid) {
            return res.status(400).json({
                success: false,
                message: "Missing user ID"
            });
        }

        const usersRef = db.collection("users");
        const userQuery = usersRef.where("uid", "==", uid).limit(1);
        const userSnapshot = await userQuery.get();

        if (userSnapshot.empty) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const userData = userSnapshot.docs[0].data();
        io.to(r).emit("authenticate", userData);
    });
    
    socket.on("fetchTest", async (sid, portalId) => {
        console.log(sid);
        const testCol = db.collection("tests");
        const userData = await getUserData(portalId);
        const query = testCol
            .where("level", "==", "200")
            .where("department", "==", userData.department);
        const querySnapshot = await query.get();
        const tests = [];
        if (!querySnapshot.empty) {
            querySnapshot.forEach(doc => {
                tests.push({ id: doc.id, ...doc.data() });
            });
        } else {
            io.to(sid).emit("fetchTest", "No test found for this level");
            return;
        }
        console.log(tests);
    });
    
    socket.on("fetchUserData", async (sid, uid) => {
        io.to(sid).emit("fetchUserData", await getUserData(uid));
    });
    
    socket.on("create-post", async postData => {
        const { sid } = postData;
        try {
            const response = await createPost(postData, io);
            io.to(sid).emit("create-post", response);
        } catch (err) {
            console.error("Error creating post:", err);
            io.to(sid).emit("create-post", "Error occurred");
        }
    });
    
    socket.on("fetch-post", async (sid, uid) => {
        io.to(sid).emit("fetch-post", await getPost(uid), sid);
    });
    
    socket.on("create-comment", async (sid, text, postId, portalId) => {
        try {
            const res = await createComment(text, postId, portalId, io);
            const c = await fetchComments(res);
            io.to(sid).emit("create-comment", c);
        } catch (err) {
            console.error("Error creating comment:", err);
        }
    });
    
    socket.on("disconnect", () => {
        // Remove user from online map
        for (var uid in onlineUsers) {
            if (onlineUsers[uid] === socket.id) {
                delete onlineUsers[uid];
                break;
            }
        }
        console.log("Client disconnected:", socket.id);
    });
});

app.post("/fetch-user", async (req, res) => {
    const { userId } = req.body;
    userId ? res.json(await getUserData(userId)) : res.json(await getUsers());
});

getAllUsersNotFriends(app);
sendRequest(app);
getRequest(app);

setupMessageRoutes(app, io);
setupSocketEvents(io);

setupUserProfileRoutes(app);

setup(app, io);

setupUploadProfileImage(app);


setupNotificationRoutes(app, io);

app.post("/api/v2/register", async (req, res) => {
    const request = req.body;
    if (lvn.includes(request.lvn)) {
        const result = await createLecturer(request);
        if (result.code == 500) {
            res.status(500).send(result);
        }
        res.json({ code: result.code, message: result.message });
    } else {
        res.status(404).send({ code: 404, message: "Invalid Lecturer ID" });
    }
});

app.post("/api/v2/login", async (req, res) => {
    const r = req.body;

    if (!r.email || !r.password) {
        res.status(501).send({ code: 501, message: "invalid credentials" });
    } else {
        const rp = await signin(r.email, r.password);
        console.log(rp);
        if (rp.code == 404) res.status(404).send(rp);
        if (rp.code == 200) {
            res.json({
                token: generateToken(rp.message, secret_key),
                name: rp.message.name
            });
        }
    }
});

app.post("/api/post-react-like", async (req, res) => {
    const { postId, portalId } = req.body;
    try {
        const response = await reactionControlLike(postId, portalId, io);
        res.json({ likes: response.reactions.likes });
    } catch (err) {
        console.error("Error liking post:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/api/send-code/v1", async (req, res) => {
    const { email, code } = req.body;
    const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: {
            user: user,
            pass: key
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    const mailOptions = {
        from: "nazoratechnologylimited@gmail.com",
        to: email,
        subject: "Consy - Code",
        text: "",
        html: `
    <html>
    <body>
      <h2>Hello there,</h2>
      <p>You recently signed up for our application. To complete your registration, please use the verification code below:</p>
      <h1>Verification Code: ${code}</h1>
      <p>Enter this code on the verification page to activate your account.</p>
      <p>If you didn't sign up for our application, please disregard this email.</p>
      <p>Best regards,</p>
      <p>Consy Inc</p>
    </body>
    </html>
    `
    };
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.log("Error:", error);
            res.status(500).send({
                code: 500,
                message: "Invalid email address"
            });
        } else {
            console.log("Email sent:", info.response);
            res.json({ code: 200, message: "Code was sent" });
        }
    });
});

app.get("/", (req, res) => {
    res.send("<h1>Welcome to consy backend!</h1>");
});

app.post("/api/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).send({ message: "No file uploaded" });
    }
    res.json({ filePath: req.file.path, type: req.file.mimetype });
});

app.post("/api/register", async (req, res) => {
    const userData = req.body;
    const { portalID } = userData;
    const r = svn.find(f => f.id == portalID);
    if (!portalID || !r) {
        res.status(500).send({ message: "invalid svn" });
        return;
    }
    const request = await verifyAndCreateUser(userData);
    if (request.code === 500) {
        res.status(500).send({ message: request.message });
    } else {
        res.json(request);
    }
});

app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        res.status(500).send({ message: "Invalid credentials" });
    }
    const response = await verifyAndLogUserIn(email, password);
    console.log(response);
    res.json({
        token: generateToken(response, secret_key),
        name: response.name
    });
});

http.listen(5000, "0.0.0.0", () => {
    console.log("Server listening on port 5000");
});
