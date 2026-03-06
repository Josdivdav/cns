const path = require("path");
const fs   = require("fs");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const { db } = require("./admin.firebase.js");
let sharp;
try { sharp = require("sharp"); } catch (_) { sharp = null; }
const UPLOAD_DIR = path.join(__dirname, "public", "profile-images");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  }
});
function deleteOldImage(oldImageUrl) {
  if (!oldImageUrl) return;
  try {
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

async function saveToDisk(buffer, mimetype, uid) {
  const ext      = mimetype.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const filename = `${uid}_${uuidv4()}.${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);

  if (sharp) {
    await sharp(buffer)
      .resize(400, 400, { fit: "cover", position: "center" })
      .jpeg({ quality: 85 })
      .toBuffer()
      .then(processed => fs.writeFileSync(filepath, processed));
  } else {
    fs.writeFileSync(filepath, buffer);
  }

  return `/profile-images/${filename}`;
}
function setupUploadProfileImage(app) {

  app.post(
    "/api/user/upload-profile-image",
    upload.single("profileImage"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ success: false, message: "No image provided" });
        }

        const { uid } = req.body;
        if (!uid) {
          return res.status(400).json({ success: false, message: "uid is required" });
        }
        const userSnap = await db.collection("users")
          .where("uid", "==", uid)
          .limit(1)
          .get();

        if (userSnap.empty) {
          return res.status(404).json({ success: false, message: "User not found" });
        }

        const userDoc  = userSnap.docs[0];
        const userData = userDoc.data();

        const imageUrl = await saveToDisk(req.file.buffer, req.file.mimetype, uid);
        if (userData.profileImage) {
          deleteOldImage(userData.profileImage);
        }
        await userDoc.ref.update({ profileImage: imageUrl });
        return res.json({
          success:  true,
          imageUrl: imageUrl,
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
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message === "Only image files are allowed") {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  });
}

module.exports = { setupUploadProfileImage };
