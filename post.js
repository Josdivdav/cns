const { db, admin } = require("./admin.firebase.js");
const { getUserData } = require("./user.js");

async function createPost(postMeta, io) {
  const { text, mediaFiles, pid, reactions, timestamp } = postMeta;
  const { likes, comments } = reactions;
  const postRef = db.collection('posts');
  const userRef = db.collection('users');
  const user_query = userRef.where('portalID', '==', pid).limit(1);
  const userQuerySnapshot = await user_query.get();
  if (!userQuerySnapshot.empty) {
    const id = db.collection('posts').doc().id;
    await postRef.doc(id).set({
      portalID: pid,
      text: text,
      mediaFiles: mediaFiles,
      timestamp: timestamp,
      reactions: {
        likes: likes,
        comments: comments,
      },
      postId: id
    });
    
    // Emit real-time update to all connected clients
    if (io) {
      const userData = await getUserData(pid);
      io.emit("new-post", {
        id: id,
        portalID: pid,
        text: text,
        mediaFiles: mediaFiles,
        timestamp: timestamp,
        reactions: { likes: likes || [], comments: comments || [] },
        postId: id,
        user: userData
      });
    }
    
    return id;
  } else {
    return {code: 404, message: "user not found"};
  }
}

// ============================================
// FETCH COMMENTS (with user data)
// ============================================
async function fetchComments(postId) {
  const commentRef = db.collection("comments");
  const comments_query = commentRef.where("postId", "==", postId);
  const query_snapshot = await comments_query.get();

  if (!query_snapshot.empty) {
    // Use map + Promise.all to handle async properly
    const comments = await Promise.all(
      query_snapshot.docs.map(async doc => {
        const commentData = doc.data();
        const userData = await getUserData(commentData.portalID);
        return { 
          id: doc.id, 
          ...commentData, 
          user: userData,
          timestamp: commentData.timestamp || Date.now()
        };
      })
    );

    // Sort by timestamp (newest first)
    comments.sort((a, b) => b.timestamp - a.timestamp);

    return comments;
  } else {
    return []; // no comments found
  }
}

// ============================================
// CREATE COMMENT (Enhanced with timestamp)
// ============================================
async function createComment(text, postId, portalId, io) {
  const commentRef = db.collection("comments");
  const id = commentRef.doc().id;
  const timestamp = Date.now();

  const commentData = {
    text: text,
    postId: postId,
    portalID: portalId,
    likes: [],
    likeCount: 0,
    timestamp: timestamp
  };

  await commentRef.doc(id).set(commentData);

  // Emit real-time update to all connected clients
  if (io) {
    const userData = await getUserData(portalId);
    io.emit("new-comment", {
      id: id,
      ...commentData,
      user: userData
    });
  }

  // Return the created comment with user data
  const userData = await getUserData(portalId);
  return {
    id: id,
    ...commentData,
    user: userData
  };
}

async function getPost(pid) {
  const postRef = db.collection("posts");
  const query_snapshot = await postRef.get();
  if (!query_snapshot.empty) {
    const data = await Promise.all(
      query_snapshot.docs.map(async doc => {
        const postData = doc.data();
        const userData = await getUserData(postData.portalID);
        const postComments = await fetchComments(postData.postId, userData.id);
        postData.reactions.comments = postComments;
        return { id: doc.id, ...postData, user: userData };
      })
    );
    return data;
  } else {
    return "Error";
  }
}

async function reactionControlLike(pid, portalId, io) {
  const postRef = db.collection("posts").doc(pid);

  try {
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(postRef);
      if (!doc.exists) {
        throw new Error("Post not found");
      }

      const reactions = doc.data().reactions || {};
      const likes = reactions.likes || [];

      if (!likes.includes(portalId)) {
        transaction.update(postRef, {
          'reactions.likes': admin.firestore.FieldValue.arrayUnion(portalId)
        });
      } else{
        transaction.update(postRef, {
          'reactions.likes': admin.firestore.FieldValue.arrayRemove(portalId)
        })
      }
    });
    
    const postData = (await postRef.get()).data();
    
    // Emit real-time update to all connected clients
    if (io) {
      io.emit("post-liked", {
        postId: pid,
        likes: postData.reactions.likes || []
      });
    }
    
    return postData;
  } catch (error) {
    console.error(error);
    return "Error";
  }
}

// ============================================
// COMMENT LIKE/UNLIKE
// ============================================
async function commentLike(app, io) {
  app.post("/api/comments/like", async (req, res) => {
    const { userId, postId, commentId } = req.body;
    
    // Validate required fields
    if (!userId || !commentId) {
      return res.status(400).json({ 
        success: false,
        error: "userId and commentId are required" 
      });
    }
    
    try {
      const commentRef = db.collection("comments").doc(commentId);
      const commentDoc = await commentRef.get();
      
      // Check if comment exists
      if (!commentDoc.exists) {
        return res.status(404).json({ 
          success: false,
          error: "Comment not found" 
        });
      }
      
      const commentData = commentDoc.data();
      const likes = commentData.likes || [];
      
      // Check if user already liked this comment
      const userLikedIndex = likes.indexOf(userId);
      const liked = userLikedIndex === -1;
      
      if (userLikedIndex > -1) {
        // Unlike: remove user from likes array
        likes.splice(userLikedIndex, 1);
      } else {
        // Like: add user to likes array
        likes.push(userId);
      }
      
      // Update the comment with new likes array
      await commentRef.update({
        likes: likes,
        likeCount: likes.length
      });
      
      // Emit real-time update to all connected clients
      if (io) {
        io.emit("comment-liked", {
          commentId: commentId,
          postId: postId,
          likeCount: likes.length,
          liked: liked,
          userId: userId
        });
      }
      
      return res.status(200).json({
        success: true,
        liked: liked,
        likeCount: likes.length
      });
      
    } catch (error) {
      console.error("Error liking comment:", error);
      return res.status(500).json({ 
        success: false,
        error: "Internal server error" 
      });
    }
  });
}

// ============================================
// SETUP COMMENT ROUTES
// ============================================
async function setupCommentRoutes(app, io) {
  // Fetch comments endpoint
  app.post("/api/fetch-comments", async (req, res) => {
    const { postId } = req.body;
    
    if (!postId) {
      return res.status(400).json({ 
        success: false,
        error: "postId is required" 
      });
    }
    
    try {
      const comments = await fetchComments(postId);
      return res.status(200).json(comments);
    } catch (error) {
      console.error("Error fetching comments:", error);
      return res.status(500).json({ 
        success: false,
        error: "Internal server error" 
      });
    }
  });

  // Create comment endpoint
  app.post("/api/comments/create", async (req, res) => {
    const { text, postId, portalId } = req.body;
    
    if (!text || !postId || !portalId) {
      return res.status(400).json({ 
        success: false,
        error: "text, postId, and portalId are required" 
      });
    }
    
    try {
      const newComment = await createComment(text, postId, portalId, io);
      return res.status(200).json({
        success: true,
        comment: newComment
      });
    } catch (error) {
      console.error("Error creating comment:", error);
      return res.status(500).json({ 
        success: false,
        error: "Internal server error" 
      });
    }
  });

  // Delete comment endpoint (optional)
  app.post("/api/comments/delete", async (req, res) => {
    const { commentId, userId } = req.body;
    
    if (!commentId || !userId) {
      return res.status(400).json({ 
        success: false,
        error: "commentId and userId are required" 
      });
    }
    
    try {
      const commentRef = db.collection("comments").doc(commentId);
      const commentDoc = await commentRef.get();
      
      if (!commentDoc.exists) {
        return res.status(404).json({ 
          success: false,
          error: "Comment not found" 
        });
      }
      
      const commentData = commentDoc.data();
      
      // Check if user owns the comment
      const userRef = db.collection("users");
      const user_query = userRef.where('uid', '==', userId).limit(1);
      const userSnapshot = await user_query.get();
      
      if (userSnapshot.empty) {
        return res.status(403).json({ 
          success: false,
          error: "Unauthorized" 
        });
      }
      
      const userData = userSnapshot.docs[0].data();
      
      if (commentData.portalID !== userData.portalID) {
        return res.status(403).json({ 
          success: false,
          error: "You can only delete your own comments" 
        });
      }
      
      await commentRef.delete();
      
      // Emit real-time update
      if (io) {
        io.emit("comment-deleted", {
          commentId: commentId,
          postId: commentData.postId
        });
      }
      
      return res.status(200).json({
        success: true,
        message: "Comment deleted successfully"
      });
      
    } catch (error) {
      console.error("Error deleting comment:", error);
      return res.status(500).json({ 
        success: false,
        error: "Internal server error" 
      });
    }
  });
}

module.exports = { 
  fetchComments, 
  createPost, 
  getPost, 
  reactionControlLike, 
  createComment, 
  commentLike,
  setupCommentRoutes
};
