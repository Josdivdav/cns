// Add this to your user.js or create a new file for user profile operations

const { db, admin } = require("./admin.firebase.js");

// ============================================
// UPDATE USER PROFILE
// ============================================
async function updateUserProfile(app) {
    app.post("/api/user/update-profile", async (req, res) => {
        try {
            const { uid, name, bioData, level } = req.body;

            if (!uid) {
                return res.status(400).json({
                    success: false,
                    message: "Missing user ID"
                });
            }

            const usersRef = db.collection("users");
            
            // Find user by UID
            const userQuery = usersRef.where("uid", "==", uid).limit(1);
            const userSnapshot = await userQuery.get();

            if (userSnapshot.empty) {
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }

            const userDoc = userSnapshot.docs[0];
            const userRef = userDoc.ref;

            // Prepare update data
            const updateData = {};
            
            if (name) updateData.name = name;
            if (level) updateData.level = level;
            
            // Update bioData fields
            if (bioData) {
                const currentBioData = userDoc.data().bioData || {};
                updateData.bioData = {
                    ...currentBioData,
                    ...bioData
                };
            }

            // Update user document
            await userRef.update(updateData);

            // Get updated user data
            const updatedUserDoc = await userRef.get();
            const updatedUserData = updatedUserDoc.data();

            res.json({
                success: true,
                message: "Profile updated successfully",
                user: updatedUserData
            });

        } catch (error) {
            console.error("Error updating profile:", error);
            res.status(500).json({
                success: false,
                message: "Server error"
            });
        }
    });
}

// ============================================
// GET USER PROFILE
// ============================================
async function getUserProfile(app) {
    app.post("/api/user/get-profile", async (req, res) => {
        try {
            const { uid } = req.body;

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

            res.json({
                success: true,
                user: userData
            });

        } catch (error) {
            console.error("Error getting profile:", error);
            res.status(500).json({
                success: false,
                message: "Server error"
            });
        }
    });
}

// ============================================
// UPLOAD PROFILE PICTURE
// ============================================
async function uploadProfilePicture(app) {
    app.post("/api/user/upload-profile-picture", async (req, res) => {
        try {
            const { uid, imageUrl } = req.body;

            if (!uid || !imageUrl) {
                return res.status(400).json({
                    success: false,
                    message: "Missing required fields"
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

            const userRef = userSnapshot.docs[0].ref;

            await userRef.update({
                profilePicture: imageUrl
            });

            res.json({
                success: true,
                message: "Profile picture updated successfully"
            });

        } catch (error) {
            console.error("Error uploading profile picture:", error);
            res.status(500).json({
                success: false,
                message: "Server error"
            });
        }
    });
}

// ============================================
// REGISTER ALL ROUTES
// ============================================
function setupUserProfileRoutes(app) {
    updateUserProfile(app);
    getUserProfile(app);
    uploadProfilePicture(app);
}

module.exports = {
    setupUserProfileRoutes,
    updateUserProfile,
    getUserProfile,
    uploadProfilePicture
};
