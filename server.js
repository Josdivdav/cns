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
    createPost,
    getPost,
    reactionControlLike,
    createComment,
    fetchComments,
    commentLike,
    setupCommentRoutes
} = require("./post.js");
const { sendRequest, getAllUsersNotFriends, getRequest } = require("./contact.js");
const { svn } = require("./svns/consy-svn.js");
const { lvn } = require("./svns/lvn.js");
const { createLecturer, signin } = require("./lecturer/auth.js");
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

// ============================================
// SOCKET.IO REAL-TIME EVENTS
// ============================================
io.on("connection", socket => {
    console.log("Client connected id: " + socket.id);
    
    socket.on("authenticate", r => {
        const token = socket.handshake.auth.token;
        io.to(r).emit("authenticate", verifyToken(token, secret_key));
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
    
    // ============================================
    // REAL-TIME POST CREATION (Updated)
    // ============================================
    socket.on("create-post", async postData => {
        const { sid } = postData;
        try {
            // Pass 'io' to createPost so it broadcasts to all clients
            const response = await createPost(postData, io);
            io.to(sid).emit("create-post", response);
            // createPost will automatically emit "new-post" to all clients
        } catch (err) {
            console.error("Error creating post:", err);
            io.to(sid).emit("create-post", "Error occurred");
        }
    });
    
    // ============================================
    // FETCH POSTS
    // ============================================
    socket.on("fetch-post", async (sid, uid) => {
        io.to(sid).emit("fetch-post", await getPost(uid), sid);
    });
    
    // ============================================
    // REAL-TIME COMMENT CREATION (Updated)
    // ============================================
    socket.on("create-comment", async (sid, text, postId, portalId) => {
        try {
            // Pass 'io' to createComment so it broadcasts to all clients
            const res = await createComment(text, postId, portalId, io);
            const c = await fetchComments(res);
            io.to(sid).emit("create-comment", c);
            // createComment will automatically emit "new-comment" to all clients
        } catch (err) {
            console.error("Error creating comment:", err);
        }
    });
    
    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
    });
});

// ============================================
// HTTP API ENDPOINTS
// ============================================

// Fetch user data
app.post("/fetch-user", async (req, res) => {
    const { userId } = req.body;
    userId ? res.json(await getUserData(userId)) : res.json(await getUsers());
});

// Contact/Friend request routes
getAllUsersNotFriends(app);
sendRequest(app);
getRequest(app);

// ============================================
// REAL-TIME COMMENT LIKE (Updated)
// ============================================
// Pass 'io' to commentLike so it broadcasts to all clients
commentLike(app, io);

// Setup comment fetch endpoint
setupCommentRoutes(app);

// Lecturer registration
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

// Lecturer login
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

// ============================================
// REAL-TIME POST LIKE (Updated)
// ============================================
app.post("/api/post-react-like", async (req, res) => {
    const { postId, portalId } = req.body;
    try {
        // Pass 'io' to reactionControlLike so it broadcasts to all clients
        const response = await reactionControlLike(postId, portalId, io);
        res.json({ likes: response.reactions.likes });
        // reactionControlLike will automatically emit "post-liked" to all clients
    } catch (err) {
        console.error("Error liking post:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Email verification code
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

// Home route
app.get("/", (req, res) => {
    res.send("<h1>Welcome to consy backend!</h1>");
});

// File upload
app.post("/api/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).send({ message: "No file uploaded" });
    }
    res.json({ filePath: req.file.path, type: req.file.mimetype });
});

// Register a user
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

// Sign in a user
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

// ============================================
// START SERVER
// ============================================
http.listen(5000, "0.0.0.0", () => {
    console.log("Server listening on port 5000");
    console.log("Real-time updates enabled via Socket.IO ✓");
});
