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
// FETCH COMMENTS WITH REPLIES
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
        
        // Fetch replies for this comment
        const replies = await fetchReplies(doc.id);
        
        return { 
          id: doc.id, 
          ...commentData, 
          user: userData,
          timestamp: commentData.timestamp || Date.now(),
          replies: replies,
          replyCount: replies.length
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
// FETCH REPLIES FOR A COMMENT
// ============================================
async function fetchReplies(commentId) {
  const replyRef = db.collection("replies");
  const replies_query = replyRef.where("commentId", "==", commentId);
  const query_snapshot = await replies_query.get();

  if (!query_snapshot.empty) {
    const replies = await Promise.all(
      query_snapshot.docs.map(async doc => {
        const replyData = doc.data();
        const userData = await getUserData(replyData.portalID);
        return { 
          id: doc.id, 
          ...replyData, 
          user: userData,
          timestamp: replyData.timestamp || Date.now()
        };
      })
    );

    // Sort by timestamp (oldest first for replies)
    replies.sort((a, b) => a.timestamp - b.timestamp);

    return replies;
  } else {
    return [];
  }
}

// ============================================
// CREATE COMMENT
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
    timestamp: timestamp,
    replyCount: 0
  };

  await commentRef.doc(id).set(commentData);

  // Emit real-time update to all connected clients
  if (io) {
    const userData = await getUserData(portalId);
    io.emit("new-comment", {
      id: id,
      ...commentData,
      user: userData,
      replies: []
    });
  }

  // Return the created comment with user data
  const userData = await getUserData(portalId);
  return {
    id: id,
    ...commentData,
    user: userData,
    replies: []
  };
}

// ============================================
// CREATE REPLY
// ============================================
async function createReply(text, commentId, postId, portalId, io) {
  const replyRef = db.collection("replies");
  const id = replyRef.doc().id;
  const timestamp = Date.now();

  const replyData = {
    text: text,
    commentId: commentId,
    postId: postId,
    portalID: portalId,
    likes: [],
    likeCount: 0,
    timestamp: timestamp
  };

  await replyRef.doc(id).set(replyData);

  // Update reply count on parent comment
  const commentRef = db.collection("comments").doc(commentId);
  await commentRef.update({
    replyCount: admin.firestore.FieldValue.increment(1)
  });

  // Emit real-time update
  if (io) {
    const userData = await getUserData(portalId);
    io.emit("new-reply", {
      id: id,
      ...replyData,
      user: userData
    });
  }

  // Return the created reply with user data
  const userData = await getUserData(portalId);
  return {
    id: id,
    ...replyData,
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
    
    if (!userId || !commentId) {
      return res.status(400).json({ 
        success: false,
        error: "userId and commentId are required" 
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
      const likes = commentData.likes || [];
      const isLiked = likes.includes(userId);
      
      // Toggle like
      if (isLiked) {
        await commentRef.update({
          likes: admin.firestore.FieldValue.arrayRemove(userId),
          likeCount: admin.firestore.FieldValue.increment(-1)
        });
      } else {
        await commentRef.update({
          likes: admin.firestore.FieldValue.arrayUnion(userId),
          likeCount: admin.firestore.FieldValue.increment(1)
        });
      }
      
      // Get updated data
      const updatedDoc = await commentRef.get();
      const updatedData = updatedDoc.data();
      
      // Emit real-time update
      if (io) {
        io.emit("comment-liked", {
          commentId: commentId,
          postId: postId,
          likes: updatedData.likes || [],
          likeCount: updatedData.likeCount || 0,
          liked: !isLiked,
          userId: userId
        });
      }
      
      res.json({
        success: true,
        liked: !isLiked,
        likeCount: updatedData.likeCount || 0
      });
      
    } catch (error) {
      console.error("Error liking comment:", error);
      res.status(500).json({ 
        success: false,
        error: "Server error" 
      });
    }
  });
}

// ============================================
// REPLY LIKE/UNLIKE
// ============================================
async function replyLike(app, io) {
  app.post("/api/replies/like", async (req, res) => {
    const { userId, replyId, commentId, postId } = req.body;
    
    if (!userId || !replyId) {
      return res.status(400).json({ 
        success: false,
        error: "userId and replyId are required" 
      });
    }
    
    try {
      const replyRef = db.collection("replies").doc(replyId);
      const replyDoc = await replyRef.get();
      
      if (!replyDoc.exists) {
        return res.status(404).json({ 
          success: false,
          error: "Reply not found" 
        });
      }
      
      const replyData = replyDoc.data();
      const likes = replyData.likes || [];
      const isLiked = likes.includes(userId);
      
      // Toggle like
      if (isLiked) {
        await replyRef.update({
          likes: admin.firestore.FieldValue.arrayRemove(userId),
          likeCount: admin.firestore.FieldValue.increment(-1)
        });
      } else {
        await replyRef.update({
          likes: admin.firestore.FieldValue.arrayUnion(userId),
          likeCount: admin.firestore.FieldValue.increment(1)
        });
      }
      
      // Get updated data
      const updatedDoc = await replyRef.get();
      const updatedData = updatedDoc.data();
      
      // Emit real-time update
      if (io) {
        io.emit("reply-liked", {
          replyId: replyId,
          commentId: commentId,
          postId: postId,
          likes: updatedData.likes || [],
          likeCount: updatedData.likeCount || 0,
          liked: !isLiked,
          userId: userId
        });
      }
      
      res.json({
        success: true,
        liked: !isLiked,
        likeCount: updatedData.likeCount || 0
      });
      
    } catch (error) {
      console.error("Error liking reply:", error);
      res.status(500).json({ 
        success: false,
        error: "Server error" 
      });
    }
  });
}

function setup(app, io) {
  app.post("/upload-post", async (req, res) => {
    const data = await createPost(req.body, io);
    res.send(data);
  });

  app.post("/fetch-post", async (req, res) => {
    const data = await getPost();
    res.send(data);
  });

  app.post("/post-like", async (req, res) => {
    const data = await reactionControlLike(req.body.postId, req.body.portalId, io);
    res.send(data);
  });

  app.post("/post-comment", async (req, res) => {
    const data = await createComment(req.body.text, req.body.postId, req.body.portalId, io);
    res.send(data);
  });

  // NEW: Reply endpoint
  app.post("/post-reply", async (req, res) => {
    try {
      const { text, commentId, postId, portalId } = req.body;
      
      if (!text || !commentId || !postId || !portalId) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields"
        });
      }
      
      const data = await createReply(text, commentId, postId, portalId, io);
      res.json({
        success: true,
        reply: data
      });
    } catch (error) {
      console.error("Error creating reply:", error);
      res.status(500).json({
        success: false,
        error: "Server error"
      });
    }
  });

  app.post("/fetch-comment", async (req, res) => {
    try {
      const { postId } = req.body;
      
      if (!postId) {
        return res.status(400).json({
          success: false,
          error: "postId is required"
        });
      }
      
      const data = await fetchComments(postId);
      res.json(data);  // Use res.json() instead of res.send()
    } catch (error) {
      console.error("Error fetching comments:", error);
      res.status(500).json({
        success: false,
        error: "Server error fetching comments"
      });
    }
  });

  // Comment and reply like endpoints
  commentLike(app, io);
  replyLike(app, io);
}

module.exports = { 
  setup, 
  getPost, 
  createComment, 
  fetchComments,
  createReply,
  fetchReplies
};
