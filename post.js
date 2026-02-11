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
        return { id: doc.id, ...commentData, user: userData };
      })
    );

    return comments;
  } else {
    return []; // no comments found
  }
}

async function createComment(text, postId, portalId, io) {
  const commentRef = db.collection("comments");
  const id = commentRef.doc().id;

  await commentRef.doc(id).set({
    text: text,
    postId: postId,
    portalID: portalId,
    likes: [],
    likeCount: 0
  });

  // Emit real-time update to all connected clients
  if (io) {
    const userData = await getUserData(portalId);
    io.emit("new-comment", {
      id: id,
      text: text,
      postId: postId,
      portalID: portalId,
      user: userData,
      likes: [],
      likeCount: 0
    });
  }

  return postId;
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
    //console.log(data);
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


async function commentLike(app, io) {
  app.post("/api/comments/like", async (req, res) => {
    const { userId, postId, commentId } = req.body;
    
    // Validate required fields
    if (!userId || !commentId) {
      return res.status(400).json({ error: "userId and commentId are required" });
    }
    
    try {
      const commentRef = db.collection("comments").doc(commentId);
      const commentDoc = await commentRef.get();
      
      // Check if comment exists
      if (!commentDoc.exists) {
        return res.status(404).json({ error: "Comment not found" });
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
      return res.status(500).json({ error: "Internal server error" });
    }
  });
}

// Add endpoint to fetch comments (for refreshing)
async function setupCommentRoutes(app) {
  app.post("/api/fetch-comments", async (req, res) => {
    const { postId } = req.body;
    
    if (!postId) {
      return res.status(400).json({ error: "postId is required" });
    }
    
    try {
      const comments = await fetchComments(postId);
      return res.status(200).json(comments);
    } catch (error) {
      console.error("Error fetching comments:", error);
      return res.status(500).json({ error: "Internal server error" });
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
