const { db, admin } = require("./admin.firebase.js");
const { getUserData } = require("./user.js");

async function createPost(postMeta) {
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

async function createComment(text, postId, portalId) {
  const commentRef = db.collection("comments");
  const id = commentRef.doc().id;

  await commentRef.doc(id).set({
    text: text,
    postId: postId,
    portalID: portalId
  });

  return id;
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

async function reactionControlLike(pid, portalId) {
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
    return (await postRef.get()).data();
  } catch (error) {
    console.error(error);
    return "Error";
  }
}

module.exports = { createPost, getPost, reactionControlLike, createComment };
