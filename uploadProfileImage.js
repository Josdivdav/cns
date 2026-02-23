/**
 * uploadProfileImage.js
 * 
 * Route: POST /api/user/upload-profile-image
 * Body:  multipart/form-data  { profileImage: <File>, uid: <string> }
 * Returns: { success: true, imageUrl: "/profile-images/uid_xxx.jpg" }
 *
 * Files are saved to:  <project_root>/public/profile-images/
 * Served at:           http://your-ec2-ip:PORT/profile-images/filename.jpg
 *
 * Install once:  npm install multer sharp uuid
 * sharp is optional — skipped gracefully if not installed
 */

const path = require("path");
const fs   = require("fs");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const { db } = require("./admin.firebase.js");

// ── Optional sharp for resize + EXIF strip ──────────────────
let sharp;
try { sharp = require("sharp"); } catch (_) { sharp = null; }

// ============================================
// UPLOAD DIRECTORY  (EC2 local disk)
// ============================================
const UPLOAD_DIR = path.join(__dirname, "public", "profile-images");

// Create dir on startup if it doesn't exist
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ============================================
// MULTER — memory storage so we can process
//          the buffer before writing to disk
// ============================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  }
});

// ============================================
// HELPERS
// ============================================

/** Delete an old profile image file from disk (non-fatal) */
function deleteOldImage(oldImageUrl) {
  if (!oldImageUrl) return;
  try {
    // oldImageUrl is like "/profile-images/uid_xxx.jpg"
    // strip leading slash and resolve to absolute path
    const rel      = oldImageUrl.replace(/^\//, "");
    const fullPath = path.join(__dirname, "public", rel);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      console.log("Deleted old profile image:", fullPath);
    }
  } catch (err) {
    console.warn("Could not delete old profile image:", err.message);
  }
}

/** Write buffer to disk, return the public URL path */
async function saveToDisk(buffer, mimetype, uid) {
  const ext      = mimetype.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const filename = `${uid}_${uuidv4()}.${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);

  // Resize + compress with sharp if available
  if (sharp) {
    await sharp(buffer)
      .resize(400, 400, { fit: "cover", position: "center" })
      .jpeg({ quality: 85 })
      .toBuffer()
      .then(processed => fs.writeFileSync(filepath, processed));
  } else {
    fs.writeFileSync(filepath, buffer);
  }

  return `/profile-images/${filename}`;  // relative URL, served as static
}

// ============================================
// ROUTE
// ============================================
function setupUploadProfileImage(app) {

  app.post(
    "/api/user/upload-profile-image",
    upload.single("profileImage"),
    async (req, res) => {
      try {
        // ── Validate ───────────────────────────────────────────
        if (!req.file) {
          return res.status(400).json({ success: false, message: "No image provided" });
        }

        const { uid } = req.body;
        if (!uid) {
          return res.status(400).json({ success: false, message: "uid is required" });
        }

        // ── Find user in Firestore ─────────────────────────────
        const userSnap = await db.collection("users")
          .where("uid", "==", uid)
          .limit(1)
          .get();

        if (userSnap.empty) {
          return res.status(404).json({ success: false, message: "User not found" });
        }

        const userDoc  = userSnap.docs[0];
        const userData = userDoc.data();

        // ── Save new image to EC2 disk ─────────────────────────
        const imageUrl = await saveToDisk(req.file.buffer, req.file.mimetype, uid);

        // ── Delete the old image (don't block response) ────────
        if (userData.profileImage) {
          deleteOldImage(userData.profileImage);
        }

        // ── Update Firestore user document ─────────────────────
        await userDoc.ref.update({ profileImage: imageUrl });

        return res.json({
          success:  true,
          imageUrl: imageUrl,   // e.g. "/profile-images/uid_xxx.jpg"
          message:  "Profile image updated"
        });

      } catch (err) {
        console.error("Upload error:", err);

        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ success: false, message: "Image must be under 5MB" });
        }

        return res.status(500).json({ success: false, message: "Server error: " + err.message });
      }
    }
  );

  // Multer/filter error handler
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message === "Only image files are allowed") {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  });
}

module.exports = { setupUploadProfileImage };
