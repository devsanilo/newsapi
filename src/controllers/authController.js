/**
 * Auth Controller
 * Email/password + Google + Apple social auth
 */
const axios = require("axios");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const User = require("../models/User");
const { generateToken } = require("../middleware/auth");
const logger = require("../utils/logger");

// Apple JWKS client — caches keys automatically
const appleJwks = jwksClient({
  jwksUri: "https://appleid.apple.com/auth/keys",
  cache: true,
  cacheMaxAge: 86400000, // 24 hours
});

function getAppleSigningKey(header) {
  return new Promise((resolve, reject) => {
    appleJwks.getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

// ─── Email/Password ───────────────────────────────────────────

async function register(req, res, next) {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "name, email, and password are required.",
      });
    }
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters.",
      });
    }

    const existing = await User.findOne({
      where: { email: email.toLowerCase().trim() },
    });
    if (existing) {
      return res
        .status(409)
        .json({ success: false, error: "Email already registered." });
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      auth_provider: "local",
    });

    res.status(201).json({
      success: true,
      data: { user: user.toSafeJSON(), token: generateToken(user) },
    });
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, error: "email and password are required." });
    }

    const user = await User.findOne({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user)
      return res
        .status(401)
        .json({ success: false, error: "Invalid email or password." });
    if (!user.is_active)
      return res
        .status(403)
        .json({ success: false, error: "Account is deactivated." });
    if (!user.password) {
      return res.status(400).json({
        success: false,
        error: `This account uses ${user.auth_provider} sign-in. Please use that method.`,
      });
    }

    const valid = await user.comparePassword(password);
    if (!valid)
      return res
        .status(401)
        .json({ success: false, error: "Invalid email or password." });

    res.json({
      success: true,
      data: { user: user.toSafeJSON(), token: generateToken(user) },
    });
  } catch (error) {
    next(error);
  }
}

// Firebase ID token verification (Google sign-in via Firebase Auth).
// Firebase ID tokens are signed by the Firebase "securetoken" service account,
// not the standard Google OAuth2 certs — so we use its dedicated JWKS endpoint.
const firebaseJwks = jwksClient({
  jwksUri:
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  cache: true,
  cacheMaxAge: 86400000, // 24 hours
});

function getFirebaseSigningKey(header) {
  return new Promise((resolve, reject) => {
    firebaseJwks.getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

async function verifyFirebaseIdToken(idToken) {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || !decoded.header || !decoded.header.kid) {
    throw new Error("Invalid token header");
  }
  const publicKey = await getFirebaseSigningKey(decoded.header);
  const payload = jwt.verify(idToken, publicKey, { algorithms: ["RS256"] });

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (projectId && payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error("Invalid Firebase issuer");
  }
  if (apiKey && payload.aud !== apiKey) {
    throw new Error("Invalid Firebase audience");
  }
  if (!payload.sub) throw new Error("No Firebase subject");
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || (payload.email || "").split("@")[0],
    picture: payload.picture || null,
  };
}

// ─── Google Sign-In ───────────────────────────────────────────

async function googleAuth(req, res, next) {
  try {
    const { id_token } = req.body;
    if (!id_token) {
      return res
        .status(400)
        .json({ success: false, error: "id_token is required." });
    }

    // Verify token — prefer a Firebase Auth ID token, fall back to a raw Google token
    let identity;
    try {
      identity = await verifyFirebaseIdToken(id_token);
    } catch (fbErr) {
      logger.warn(`Firebase ID token verification failed: ${fbErr.message}`);
      try {
        const resp = await axios.get(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${id_token}`,
          { timeout: 8000 },
        );
        const g = resp.data;
        identity = {
          sub: g.sub,
          email: g.email,
          name: g.name,
          picture: g.picture,
        };
      } catch (err) {
        logger.warn(`Google tokeninfo fallback failed: ${err.message}`);
        return res
          .status(401)
          .json({ success: false, error: "Invalid Google ID token." });
      }
    }

    const { sub, email, name, picture } = identity;
    if (!email)
      return res
        .status(400)
        .json({ success: false, error: "Google account has no email." });

    // Find or create user
    let user = await User.findOne({ where: { email: email.toLowerCase() } });

    if (user) {
      // Link Google if not already linked
      if (!user.auth_provider_id && user.auth_provider === "local") {
        user.auth_provider = "google";
        user.auth_provider_id = sub;
        if (!user.avatar && picture) user.avatar = picture;
        user.updated_at = new Date();
        await user.save();
      }
    } else {
      user = await User.create({
        name: name || email.split("@")[0],
        email: email.toLowerCase(),
        password: null,
        avatar: picture || null,
        auth_provider: "google",
        auth_provider_id: sub,
      });
    }

    if (!user.is_active)
      return res
        .status(403)
        .json({ success: false, error: "Account is deactivated." });

    res.json({
      success: true,
      data: { user: user.toSafeJSON(), token: generateToken(user) },
    });
  } catch (error) {
    next(error);
  }
}

// ─── Apple Sign-In ────────────────────────────────────────────

async function appleAuth(req, res, next) {
  try {
    const { id_token, name: appleName } = req.body;
    if (!id_token) {
      return res
        .status(400)
        .json({ success: false, error: "id_token is required." });
    }

    // Verify Apple JWT against Apple's public JWKS keys
    let payload;
    try {
      payload = await new Promise((resolve, reject) => {
        jwt.verify(
          id_token,
          (header, callback) => {
            getAppleSigningKey(header)
              .then((key) => callback(null, key))
              .catch((err) => callback(err));
          },
          {
            algorithms: ["RS256"],
            issuer: "https://appleid.apple.com",
            // audience could be validated here too: audience: process.env.APPLE_CLIENT_ID
          },
          (err, decoded) => {
            if (err) return reject(err);
            resolve(decoded);
          },
        );
      });
    } catch (verifyError) {
      logger.warn("Apple JWT verification failed:", verifyError.message);
      return res
        .status(401)
        .json({ success: false, error: "Invalid Apple ID token." });
    }

    const { sub, email } = payload;
    if (!email)
      return res
        .status(400)
        .json({ success: false, error: "Apple account has no email." });

    let user = await User.findOne({ where: { email: email.toLowerCase() } });

    if (user) {
      if (!user.auth_provider_id && user.auth_provider === "local") {
        user.auth_provider = "apple";
        user.auth_provider_id = sub;
        user.updated_at = new Date();
        await user.save();
      }
    } else {
      // Apple only sends name on first sign-in
      const displayName = appleName || email.split("@")[0];
      user = await User.create({
        name: displayName,
        email: email.toLowerCase(),
        password: null,
        auth_provider: "apple",
        auth_provider_id: sub,
      });
    }

    if (!user.is_active)
      return res
        .status(403)
        .json({ success: false, error: "Account is deactivated." });

    res.json({
      success: true,
      data: { user: user.toSafeJSON(), token: generateToken(user) },
    });
  } catch (error) {
    next(error);
  }
}

// ─── Profile ──────────────────────────────────────────────────

async function getProfile(req, res, next) {
  try {
    res.json({ success: true, data: req.user.toSafeJSON() });
  } catch (error) {
    next(error);
  }
}

async function updateProfile(req, res, next) {
  try {
    const { name, avatar, bio, phone, location, website } = req.body;
    const user = await User.findByPk(req.user.id);
    if (name) user.name = name.trim();
    if (avatar !== undefined) user.avatar = avatar;
    if (bio !== undefined) user.bio = bio;
    if (phone !== undefined) user.phone = phone;
    if (location !== undefined) user.location = location;
    if (website !== undefined) user.website = website;
    user.updated_at = new Date();
    await user.save();
    res.json({ success: true, data: user.toSafeJSON() });
  } catch (error) {
    next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({
        success: false,
        error: "current_password and new_password are required.",
      });
    }
    if (new_password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "New password must be at least 6 characters.",
      });
    }

    const user = await User.findByPk(req.user.id);
    if (!user.password) {
      return res.status(400).json({
        success: false,
        error: "Social auth accounts cannot change password. Set one first.",
      });
    }
    const valid = await user.comparePassword(current_password);
    if (!valid)
      return res
        .status(401)
        .json({ success: false, error: "Current password is incorrect." });

    user.password = new_password;
    user.updated_at = new Date();
    await user.save();
    res.json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  register,
  login,
  googleAuth,
  appleAuth,
  getProfile,
  updateProfile,
  changePassword,
};
