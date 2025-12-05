const { db } = require("./admin.firebase.js");
async function getUserData(uid) {
  const usersRef = db.collection('users');
  const query = usersRef.where('portalID', '==', uid).limit(1);
  try {
    const querySnapshot = await query.get();
    if (!querySnapshot.empty) {
      const userData = (querySnapshot.docs[0]).data();
      const { password, ...rest } = userData;
      return rest;
    }
  } catch(err) {
    console.log(err)
  }
}
async function getUsers() {
  const usersRef = db.collection('users');
  //const query = usersRef.where('userId', '==', uid).limit(1);
  try {
    const querySnapshot = await usersRef.get();
    if (!querySnapshot.empty) {
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return data;
    }
  } catch(err) {
    console.log(err)
  }
}
async function getUserData(portalId) {
  const usersRef = db.collection("users");
  const userQuery = usersRef.where("portalID", "==", portalId);
  const res = await userQuery.get();
  if (!res.empty) {
    const userData = res.docs.map(doc => ({ id: doc.id, ...doc.data() }))[0];
    return userData;
  }
  return null; // Optional: handle case where no user is found
}
async function getUserDataC(contactId) {
  const usersRef = db.collection("users");
  const userQuery = usersRef.where("uid", "==", contactId);
  const res = await userQuery.get();
  if (!res.empty) {
    const userData = res.docs.map(doc => ({ id: doc.id, ...doc.data() }))[0];
    return userData;
  }
  return null; // Optional: handle case where no user is found
}
module.exports = { getUserData, getUsers, getUserData, getUserDataC };