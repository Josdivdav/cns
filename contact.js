const { db, admin } = require("./admin.firebase.js");
const { getUserDataC } = require("./user.js");

async function getContacts(seed) {
  if (!seed) {
    return "Invalid CID";
  }
  const contactRef = db
    .collection("contacts")       // top-level collection
    .doc(seed)                    // specific document (seed is the doc ID)
    .collection("userContacts");

  const contactRes = await contactRef.get();

  if (!contactRes.empty) {
    // Extract data from the snapshot
    const data = await Promise.all(
      contactRes.docs.map(async doc => {
        const postData = doc.data();
        const userData = await getUserDataC(postData.contactId);
        console.log(userData);
        return { id: doc.id, ...postData, user: userData };
      })
    );
    return data;
  } else {
    return "Invalid CID";
  }
}

async function removeContact(contactId, seed) {
  try {
    const contactRef = db
      .collection("contacts")
      .doc(seed)
      .collection("userContacts");
    
    const query = contactRef.where("contactId", "==", contactId);
    const snapshot = await query.get();
    
    if (snapshot.empty) {
      throw new Error("Contact not found");
    }
    
    // Delete all matching contacts (should be only one)
    const deletePromises = snapshot.docs.map(doc => doc.ref.delete());
    await Promise.all(deletePromises);
    
    console.log(`Contact ${contactId} removed successfully`);
    return true;
    
  } catch (error) {
    console.error("Error removing contact:", error);
    throw error;
  }
}

async function addContact(contactId, seed) {
  const contactRef = db
    .collection("contacts")
    .doc(seed)                     // put contacts under this seed document
    .collection("userContacts");   // subcollection name
  const newDocRef = contactRef.doc(); // auto-generate ID
  await newDocRef.set({
    contactId: contactId,
    contactDocId: newDocRef.id
  });

  return newDocRef.id;
}

async function acn(id, c) {
  try {
    const yt = db.collection("contacts").doc(id).collection("userContacts");
    const qy = yt.where("contactId", "==", c);
    const r = await qy.get();
    return !r.empty;
  } catch (error) {
    console.error("Error checking contact:", error);
    return false;
  }
}

async function dfa(id, c) {
  try {
    const yt = db.collection("contacts").doc(c).collection("userContacts");
    const qy = yt.where("contactId", "==", id);
    const r = await qy.get();
    return !r.empty;
  } catch (error) {
    console.error("Error checking contact:", error);
    return false;
  }
}

async function fetchAllContact(uid) {
  try {
    const cref = db.collection("users");
    const snapshot = await cref.get();
    
    if (snapshot.empty) {
      return [];
    }

    // Get all user data first
    const allUsers = snapshot.docs.map(doc => doc.data());
    
    // Check contacts for all users at once
    const filteredArray = [];
    await Promise.all(
      allUsers.map(async (suggData) => {
        if (suggData.uid !== uid) { // Avoid adding self
          const isContact = await acn(uid, suggData.uid);
          const mContact = await dfa(uid, suggData.uid);
          console.log(mContact);
          if (!isContact && !mContact) {
            filteredArray.push({...suggData, med: "suggestion"});
          } else if(mContact) {
	    filteredArray.push({...suggData, med: "request"});
	  }
        }
      })
    );
    
    return filteredArray;
  } catch (error) {
    console.error("Error fetching contacts:", error);
    return [];
  }
}

module.exports = { getContacts, fetchAllContact, addContact };
