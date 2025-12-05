const { db } = require("../admin.firebase.js");

async function createLecturer(data) {
  const { name, email, password, lvn } = data;
  const lecturersColl = db.collection("lecturers");
  const ssi = await lecturersColl.where('lvn', '==', lvn).limit(1).get();
  let query = lecturersColl.where("email", "==", email);
  query = await query.get();
  if(query.empty) {
    const id = lecturersColl.doc().id;
    if(ssi.empty) {
      await lecturersColl.doc(id).set(data);
      return {code: 201, message: "Account successfully created"};
    } else {
      return {code: 500, message: "LVN has been taken"};
    }
  } else {
    return {code: 500, message: "Lecturer with this email exist"};
  }
}

async function signin(email, password) {
  const usersRef = db.collection('lecturers');
  const query = usersRef.where('email', '==', email).where('password', '==', password).select("email", "password", "lvn", "name").limit(1);
  try {
    const querySnapshot = await query.get();
    if (!querySnapshot.empty) {
      const userData = querySnapshot.docs[0];
      return {code: 200, message: userData.data()};
    } else {
      return {code: 404, message: "Account does not exist"};
    }
  } catch(err) {
    console.log(err)
    return {code: 500, message: "Error please try again"};
  }
}

module.exports = { createLecturer, signin };
