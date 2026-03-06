const { db, admin } = require("./admin.firebase.js");
const { getUserData } = require("./user.js");
const {
    notifyPostLike,
    notifyPostComment,
    notifyCommentLike,
    notifyCommentReply
} = require("./notifications.js");

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
    const comments = await Promise.all(
      query_snapshot.docs.map(async doc => {
        const commentData = doc.data();
        const userData = await getUserData(commentData.portalID);
        
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
    comments.sort((a, b) => b.timestamp - a.timestamp);

    return comments;
  } else {
    return [];
  }
}

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
    replies.sort((a, b) => a.timestamp - b.timestamp);

    return replies;
  } else {
    return [];
  }
}

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

  await notifyPostComment(postId, portalId, id, io);
  if (io) {
    const userData = await getUserData(portalId);
    io.emit("new-comment", {
      id: id,
      ...commentData,
      user: userData,
      replies: []
    });
  }
  const userData = await getUserData(portalId);
  return {
    id: id,
    ...commentData,
    user: userData,
    replies: []
  };
}

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
  await notifyCommentReply(commentId, portalId, id, io);
  const commentRef = db.collection("comments").doc(commentId);
  await commentRef.update({
    replyCount: admin.firestore.FieldValue.increment(1)
  });
  
  if (io) {
    const userData = await getUserData(portalId);
    io.emit("new-reply", {
      id: id,
      ...replyData,
      user: userData
    });
  }
  
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
    
    await notifyPostLike(pid, portalId, io);
    
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
      
      if (isLiked) {
        await commentRef.update({
          likes: admin.firestore.FieldValue.arrayRemove(userId),
          likeCount: admin.firestore.FieldValue.increment(-1)
        });
        await notifyCommentLike(commentId, userId, io);
      } else {
        await commentRef.update({
          likes: admin.firestore.FieldValue.arrayUnion(userId),
          likeCount: admin.firestore.FieldValue.increment(1)
        });
      }
    
      const updatedDoc = await commentRef.get();
      const updatedData = updatedDoc.data();
      
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
      
      const updatedDoc = await replyRef.get();
      const updatedData = updatedDoc.data();
      
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

async function deletePost(postId, portalID) {
  let postDocRef = null;
  let postData   = null;

  const directDoc = await db.collection("posts").doc(postId).get();
  if (directDoc.exists) {
    postDocRef = directDoc.ref;
    postData   = directDoc.data();
  } else {
    const snap = await db.collection("posts").where("postId", "==", postId).limit(1).get();
    if (snap.empty) return { success: false, message: "Post not found" };
    postDocRef = snap.docs[0].ref;
    postData   = snap.docs[0].data();
  }
  if (String(postData.portalID) !== String(portalID)) {
    return { success: false, message: "Unauthorized" };
  }
  await postDocRef.delete();
  const commentsSnap = await db.collection("comments").where("postId", "==", postId).get();
  if (!commentsSnap.empty) {
    const batch = db.batch();
    for (const commentDoc of commentsSnap.docs) {
      const repliesSnap = await db.collection("replies").where("commentId", "==", commentDoc.id).get();
      repliesSnap.docs.forEach(r => batch.delete(r.ref));
      batch.delete(commentDoc.ref);
    }
    await batch.commit();
  }

  return { success: true };
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
      res.json(data);
    } catch (error) {
      console.error("Error fetching comments:", error);
      res.status(500).json({
        success: false,
        error: "Server error fetching comments"
      });
    }
  });
  commentLike(app, io);
  replyLike(app, io);
  app.post("/api/posts/delete-post", async (req, res) => {
    try {
      const { postId, portalID } = req.body;
      if (!postId || !portalID) {
        return res.status(400).json({ success: false, message: "postId and portalID are required" });
      }
      const result = await deletePost(postId, portalID);
      if (!result.success) {
        return res.status(result.message === "Unauthorized" ? 403 : 404).json(result);
      }
      if (io) {
        io.emit("post-deleted", { postId });
      }

      res.json({ success: true, message: "Post deleted" });
    } catch (err) {
      console.error("Delete post error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });
}

module.exports = { 
  setup, 
  getPost, 
  createComment, 
  fetchComments,
  createReply,
  fetchReplies,
  deletePost,
  createPost,
  reactionControlLike
};
