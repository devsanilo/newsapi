/**
 * Firebase Cloud Messaging Service
 * Handles push notification delivery via FCM
 */
const admin = require("firebase-admin");
const logger = require("../utils/logger");

let _initialized = false;

/**
 * Initialize Firebase Admin SDK (call once at startup)
 * Requires FIREBASE_SERVICE_ACCOUNT_PATH env variable pointing to the JSON key file,
 * or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY env variables.
 */
function initFirebase() {
  if (_initialized) return;

  try {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (serviceAccountPath) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
    ) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(
            /\\n/g,
            "\n",
          ),
        }),
      });
    } else {
      logger.warn(
        "Firebase credentials not configured — push notifications disabled.",
      );
      return;
    }
    _initialized = true;
    logger.info("✅ Firebase Admin SDK initialized.");
  } catch (error) {
    logger.error(`Firebase init failed: ${error.message}`);
  }
}

/**
 * Send push notification to a single FCM token
 * @param {string} token - FCM device token
 * @param {Object} payload - { title, body, data?, imageUrl? }
 * @returns {string|null} - message ID or null on failure
 */
async function sendToDevice(token, { title, body, data = {}, imageUrl }) {
  if (!_initialized || !token) return null;

  const message = {
    token,
    notification: { title, body, ...(imageUrl && { image: imageUrl }) },
    data: Object.entries(data).reduce((acc, [k, v]) => {
      acc[k] = String(v);
      return acc;
    }, {}),
    android: {
      priority: "high",
      notification: { channelId: "news_default", sound: "default" },
    },
    apns: {
      payload: { aps: { sound: "default", badge: 1 } },
    },
  };

  try {
    const id = await admin.messaging().send(message);
    return id;
  } catch (error) {
    if (
      error.code === "messaging/registration-token-not-registered" ||
      error.code === "messaging/invalid-registration-token"
    ) {
      logger.warn(`FCM token invalid/expired: ${token.slice(0, 20)}…`);
      return "INVALID_TOKEN";
    }
    logger.error(`FCM send error: ${error.message}`);
    return null;
  }
}

/**
 * Send push to multiple tokens (batched, max 500 per call)
 * @param {string[]} tokens
 * @param {{ title, body, data?, imageUrl? }} payload
 * @returns {{ success: number, failure: number, invalidTokens: string[] }}
 */
async function sendToDevices(tokens, payload) {
  if (!_initialized || !tokens.length)
    return { success: 0, failure: 0, invalidTokens: [] };

  const results = { success: 0, failure: 0, invalidTokens: [] };

  // FCM sendEachForMulticast supports up to 500 tokens
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const message = {
      notification: {
        title: payload.title,
        body: payload.body,
        ...(payload.imageUrl && { image: payload.imageUrl }),
      },
      data: Object.entries(payload.data || {}).reduce((acc, [k, v]) => {
        acc[k] = String(v);
        return acc;
      }, {}),
      tokens: batch,
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      results.success += response.successCount;
      results.failure += response.failureCount;
      response.responses.forEach((r, idx) => {
        if (
          r.error &&
          (r.error.code === "messaging/registration-token-not-registered" ||
            r.error.code === "messaging/invalid-registration-token")
        ) {
          results.invalidTokens.push(batch[idx]);
        }
      });
    } catch (error) {
      logger.error(`FCM multicast error: ${error.message}`);
      results.failure += batch.length;
    }
  }

  return results;
}

/**
 * Send notification to a topic (e.g. "breaking_news", "category_sports")
 */
async function sendToTopic(topic, { title, body, data = {}, imageUrl }) {
  if (!_initialized) return null;

  const message = {
    topic,
    notification: { title, body, ...(imageUrl && { image: imageUrl }) },
    data: Object.entries(data).reduce((acc, [k, v]) => {
      acc[k] = String(v);
      return acc;
    }, {}),
  };

  try {
    return await admin.messaging().send(message);
  } catch (error) {
    logger.error(`FCM topic send error: ${error.message}`);
    return null;
  }
}

module.exports = {
  initFirebase,
  sendToDevice,
  sendToDevices,
  sendToTopic,
};
