const { db } = require("./admin.firebase.js");

const verifyAndCreateUser = async (userData) => {
  const usersRef = db.collection('users');
  const { email, portalID } = userData;
  const query = usersRef.where('email', '==', email);
  const ssi = await usersRef.where('portalID', '==', portalID).limit(1).get();
  try {
    if(!ssi.empty) return {code: 500, message: "SVN has been used"};
    const querySnapshot = await query.get();
    if (querySnapshot.empty && ssi.empty) {
      // User doesn't exist, create a new one
      const id = db.collection('users').doc().id;
      await usersRef.doc(id).set(userData);
      console.log("Document written with id: "+id);
      return {code: 200, message: "user was created"};
    } else {
      console.log('User already exists');
      return {code: 500, message: "User already exists"};
    }
  } catch (error) {
    console.error(error);
    return {code: 500, message: "user creation error"};
  }
}

const verifyAndLogUserIn = async (email, password) => {
  console.log(email + " "+ password);
  const usersRef = db.collection('users');
  const query = usersRef.where('email', '==', email).where('password', '==', password).limit(1);
  try {
    const querySnapshot = await query.get();
    if (!querySnapshot.empty) {
      const userData = querySnapshot.docs[0];
      return userData.data();
    } else {
      return "Incorrect credentials";
    }
  } catch(err) {
    console.log("Incorrect credentials");
  }
}
module.exports = { verifyAndCreateUser, verifyAndLogUserIn };
