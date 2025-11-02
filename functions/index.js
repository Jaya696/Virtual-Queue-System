const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

exports.dequeueQueue = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("POST only");

  const queueName = (req.body && req.body.queueName) || req.query.queueName;
  if (!queueName) return res.status(400).json({ ok: false, error: "Missing queueName" });

  const queueRef = admin.database().ref(`/queues/${queueName}`);

  try {
    const result = await queueRef.transaction(current => {
      if (!current) return current;

      const items = { ...current };
      delete items.serving;
      delete items.history;

      const keys = Object.keys(items);
      if (keys.length === 0) return current;

      const earliestKey = keys[0];
      const popped = items[earliestKey];

      delete current[earliestKey];
      current.serving = popped;
      if (!current.history) current.history = {};
      current.history[earliestKey] = popped;

      return current;
    });

    if (!result.committed)
      return res.status(200).json({ ok: true, message: "Nothing to dequeue" });

    return res.status(200).json({ ok: true, served: result.snapshot.val().serving });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});
