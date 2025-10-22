export function createUserService(collection) {
  async function findByEmail(email, options = {}) {
    if (!email) {
      return null;
    }
    return collection.findOne({ email }, options);
  }

  async function createUser({ email, salt, hash }) {
    await collection.insertOne({
      email,
      salt,
      hash,
      createdAt: Date.now()
    });
  }

  async function updatePassword(email, { salt, hash }) {
    await collection.updateOne(
      { email },
      {
        $set: {
          salt,
          hash,
          passwordChangedAt: Date.now()
        }
      }
    );
  }

  async function listEmails() {
    const users = await collection.find({}, { projection: { email: 1, _id: 0 } }).toArray();
    return users.map((user) => user.email);
  }

  async function count() {
    return collection.countDocuments();
  }

  return {
    findByEmail,
    createUser,
    updatePassword,
    listEmails,
    count
  };
}
